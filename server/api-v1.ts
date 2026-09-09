/**
 * server/api-v1.ts
 *
 * The /api/v1 routes: the deterministic engine behind a key.
 *
 * Every handler follows the same shape — validate with Zod, run the pure
 * engine, attach the model stamp, provenance and rate freshness, return. No
 * generated text, no inference, and an explicit refusal when an input falls
 * outside a published schedule.
 */

import type { Express, Request, RequestHandler, Response } from "express";

import {
  API_DISCLAIMER_DE,
  API_PREFIX,
  API_VERSION,
  CalculateRequestSchema,
  EligibilityRequestSchema,
  type ApiModelStamp,
  type ApiV1Endpoint,
  type ApiV1Error,
  type ApiV1ErrorCode,
  type CalculateResponse,
  type AllocationResponse,
  type EligibilityResponse,
  type MesskonzeptResponse,
  type MetaResponse,
  type ProvenanceEntry,
  AllocationRequestSchema,
  BillingRequestSchema,
  IdentifierCheckRequestSchema,
  MAKO_PREFIX,
  MarketGridRequestSchema,
  MesskonzeptRequestSchema,
  MsconsRequestSchema,
  type BillingResponse,
  type IdentifierCheckResponse,
  type MarketGridResponse,
  type MsconsResponse,
} from "../shared/api-contract.js";
import {
  MarketTimeError,
  dayGrid,
  edifact303,
  rangeGrid,
} from "../shared/market-time.js";
import { CHECK_DIGIT_ALGORITHMS, validateMessageIdentifiers } from "../shared/market-ids.js";
import { MsconsError, buildMscons } from "../shared/mscons.js";
import { verifyInterchange } from "../shared/edifact.js";
import { BillingError, billPeriod, reconcile } from "../shared/billing.js";
import {
  AllocationError,
  allocate,
  compareKeys,
  KEY_LABEL_DE,
  type AllocationKey,
  type AllocationResult,
} from "../shared/allocation.js";
import { criticalPath, deriveMesskonzept } from "../shared/messkonzept.js";
import {
  ASSUMPTION_SET,
  MODEL_VERSION,
  resolveAssumptions,
  type MieterstromAssumptionKey,
} from "../shared/assumptions.js";
import { evaluateEligibility } from "../shared/eligibility.js";
import {
  LEGAL_MODELS,
  LEGAL_MODEL_ORDER,
  calculatorCoverageStatement,
  formatCitation,
} from "../shared/legal-models.js";
import { PILOT_OFFER_FULFILLMENT } from "../shared/pilot-order.js";
import type { MieterstromInputs, PilotOfferCode } from "../shared/schema.js";
import {
  DATED_TABLES,
  FEED_IN_TARIFF,
  MIETERSTROM_ZUSCHLAG,
  bandLabel,
  freshness,
  freshnessReport,
  lookupRate,
  priceCapCheck,
  regimeWarning,
} from "../shared/tariffs.js";
import { calculateMieterstrom, DEFAULTS } from "../shared/mieterstrom.js";
import { extractApiKey, identifyApiKey } from "./api-keys.js";

// ============================================================================
// HELPERS
// ============================================================================

function apiV1Error(
  res: ResultSink,
  status: number,
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): void {
  const body: ApiV1Error = { ok: false, code, message, details };
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

function stamp(now: Date): ApiModelStamp {
  return {
    apiVersion: API_VERSION,
    modelVersion: MODEL_VERSION,
    assumptionSet: ASSUMPTION_SET,
    jurisdiction: "DE",
    currency: "EUR",
    calculatedAt: now.toISOString(),
  };
}

/**
 * Fill omitted inputs with the sourced default for THIS plant size.
 *
 * The regulated rates are banded, so the default depends on kwp. Taking the
 * 30 kWp default for an 80 kWp plant would apply another band's rate.
 */
function resolveInputs(partial: Partial<MieterstromInputs> & { kwp: number }): {
  inputs: MieterstromInputs;
  outOfBand: string[];
} {
  const kwp = partial.kwp;
  const outOfBand: string[] = [];

  const feedIn = lookupRate(FEED_IN_TARIFF, kwp);
  const zuschlag = lookupRate(MIETERSTROM_ZUSCHLAG, kwp);
  if (feedIn === null) outOfBand.push("einspeiseverguetungCtPerKwh");
  if (zuschlag === null) outOfBand.push("mieterstromZuschlagCtPerKwh");

  const inputs: MieterstromInputs = {
    ...DEFAULTS,
    einspeiseverguetungCtPerKwh: feedIn ?? DEFAULTS.einspeiseverguetungCtPerKwh,
    mieterstromZuschlagCtPerKwh: zuschlag ?? DEFAULTS.mieterstromZuschlagCtPerKwh,
    ...partial,
  };

  return { inputs, outOfBand };
}

function provenanceFor(inputs: MieterstromInputs): ProvenanceEntry[] {
  const defaults = {
    ...DEFAULTS,
    einspeiseverguetungCtPerKwh:
      lookupRate(FEED_IN_TARIFF, inputs.kwp) ?? DEFAULTS.einspeiseverguetungCtPerKwh,
    mieterstromZuschlagCtPerKwh:
      lookupRate(MIETERSTROM_ZUSCHLAG, inputs.kwp) ?? DEFAULTS.mieterstromZuschlagCtPerKwh,
  };

  return resolveAssumptions(
    inputs as unknown as Record<MieterstromAssumptionKey, number>,
    defaults as unknown as Record<MieterstromAssumptionKey, number>,
  ).map((r) => ({
    key: r.key,
    label: r.label,
    unit: r.unit,
    value: r.value,
    source: r.source,
    sourceLabel: r.sourceLabel,
    verified: r.verified,
  }));
}

function freshnessPayload(now: Date) {
  return freshnessReport(now);
}

/** Scenario spread, matching what the website shows. */
function scenarioBundle(inputs: MieterstromInputs) {
  const conservative: MieterstromInputs = {
    ...inputs,
    eigenverbrauchsquote: Math.max(0.05, inputs.eigenverbrauchsquote - 0.1),
    investitionEurPerKwp: inputs.investitionEurPerKwp * 1.15,
  };
  const optimistic: MieterstromInputs = {
    ...inputs,
    eigenverbrauchsquote: Math.min(0.95, inputs.eigenverbrauchsquote + 0.1),
    investitionEurPerKwp: inputs.investitionEurPerKwp * 0.9,
  };
  return {
    konservativ: calculateMieterstrom(conservative),
    realistisch: calculateMieterstrom(inputs),
    optimistisch: calculateMieterstrom(optimistic),
  };
}

function buildWarnings(
  inputs: MieterstromInputs,
  outOfBand: string[],
  now: Date,
): { code: string; message: string }[] {
  const warnings: { code: string; message: string }[] = [];

  for (const key of outOfBand) {
    warnings.push({
      code: "rate_out_of_published_band",
      message: `Für ${inputs.kwp} kWp (${bandLabel(FEED_IN_TARIFF, inputs.kwp)}) liegt kein veröffentlichter Satz für "${key}" vor. Es wurde der Vorgabewert verwendet; bitte projektspezifisch setzen.`,
    });
  }

  for (const [name, table] of Object.entries(DATED_TABLES)) {
    const f = freshness(table, now);
    if (f.status === "expired") {
      warnings.push({
        code: "rate_expired",
        message: `Der hinterlegte Satz "${name}" war bis ${f.validUntil} gültig und ist nicht mehr aktuell.`,
      });
    } else if (f.status === "expiring") {
      warnings.push({
        code: "rate_expiring",
        message: `Der hinterlegte Satz "${name}" gilt noch ${f.daysRemaining} Tage (bis ${f.validUntil}).`,
      });
    }
  }

  const regime = regimeWarning();
  if (regime.applies) {
    warnings.push({ code: "feed_in_regime_change", message: `${regime.headline}. ${regime.detail}` });
  }

  // Reported as unknown rather than assumed: without the local basic-supply
  // tariff the cap cannot be evaluated.
  const cap = priceCapCheck(inputs.strompreisMieterCtPerKwh);
  if (cap.status === "unknown") {
    warnings.push({
      code: "price_cap_unchecked",
      message:
        "Die gesetzliche Preisobergrenze konnte nicht geprüft werden, da der örtliche Grundversorgungstarif nicht übergeben wurde.",
    });
  }

  return warnings;
}

/**
 * Which key placed the most energy with participants, and by how much.
 *
 * Comparative, not advisory: it reports the computed difference between the
 * best and worst key on this data. It does not state which key may be agreed
 * in a given constellation.
 */
function recommendKey(runs: Record<AllocationKey, AllocationResult>) {
  const entries = Object.entries(runs) as [AllocationKey, AllocationResult][];
  if (entries.length < 2) return null;

  const sorted = [...entries].sort(
    (a, b) => b[1].totals.allocatedKwh - a[1].totals.allocatedKwh,
  );
  const [bestKey, best] = sorted[0];
  const [worstKey, worst] = sorted[sorted.length - 1];

  return {
    key: bestKey,
    keyLabel: KEY_LABEL_DE[bestKey],
    additionalSelfConsumptionKwh: best.totals.allocatedKwh - worst.totals.allocatedKwh,
    additionalSelfConsumptionPoints:
      (best.totals.selfConsumptionRate - worst.totals.selfConsumptionRate) * 100,
    comparedTo: worstKey,
  };
}

// ============================================================================
// MOUNT
// ============================================================================

// ============================================================================
// HANDLERS
// ----------------------------------------------------------------------------
// Each endpoint is a function over its input, not a closure over an Express
// request. Both the HTTP route and the MCP tool of the same name run the
// SAME function, so a refusal, a warning or a stamp cannot differ between the
// two surfaces — which it would within a week if there were two code paths.
// ============================================================================

/**
 * The subset of the Express response the handlers use.
 *
 * An Express Response satisfies it, and so does the in-process collector the
 * MCP dispatcher passes in.
 */
export type ResultSink = {
  status(code: number): ResultSink;
  json(body: unknown): ResultSink;
  setHeader(name: string, value: string): void;
};

export function handleMeta(payload: unknown, res: ResultSink): void {
  const now = new Date();
  const rates = Object.fromEntries(
    Object.entries(DATED_TABLES).map(([name, t]) => [
      name,
      {
        bands: t.bands.map((b) => ({ maxKwp: b.maxKwp, ctPerKwh: b.ctPerKwh })),
        legalBasis: t.legalBasis,
        validFrom: t.validFrom,
        validUntil: t.validUntil,
        verified: t.verified,
        freshness: freshness(t, now),
      },
    ]),
  );

  const body: MetaResponse = {
    ok: true,
    model: stamp(now),
    rates,
    models: LEGAL_MODEL_ORDER.map((id) => {
      const m = LEGAL_MODELS[id];
      return {
        id: m.id,
        name: m.name,
        scope: m.scope,
        computed: m.modelledByCalculator,
        citation: formatCitation(m),
      };
    }),
    endpoints: [
      `${API_PREFIX}/meta`,
      `${API_PREFIX}/calculate`,
      `${API_PREFIX}/eligibility`,
      `${API_PREFIX}/messkonzept`,
      `${API_PREFIX}/allocation`,
      `${API_PREFIX}/billing`,
      `${MAKO_PREFIX}/grid`,
      `${MAKO_PREFIX}/identifiers`,
      `${MAKO_PREFIX}/mscons`,
    ],
  };

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(body);
}

export function handleCalculate(payload: unknown, res: ResultSink): void {
  const parsed = CalculateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return void apiV1Error(res, 400, "validation_error", "Ungültige Eingaben.", parsed.error.issues);
  }

  const now = new Date();
  const { inputs, outOfBand } = resolveInputs(parsed.data.inputs);
  const scenarios = scenarioBundle(inputs);

  const body: CalculateResponse = {
    ok: true,
    reference: parsed.data.reference ?? null,
    model: stamp(now),
    scenarios: {
      konservativ: scenarios.konservativ.kpis,
      realistisch: scenarios.realistisch.kpis,
      optimistisch: scenarios.optimistisch.kpis,
    },
    schedule: parsed.data.includeSchedule ? scenarios.realistisch.jahre : null,
    provenance: provenanceFor(inputs),
    freshness: freshnessPayload(now),
    coverage: calculatorCoverageStatement(),
    warnings: buildWarnings(inputs, outOfBand, now),
  };

  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).json(body);
}

export function handleEligibility(payload: unknown, res: ResultSink): void {
  const parsed = EligibilityRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return void apiV1Error(res, 400, "validation_error", "Ungültige Eingaben.", parsed.error.issues);
  }

  const now = new Date();
  const { inputs } = resolveInputs(parsed.data.inputs);
  const evaluation = evaluateEligibility({
    economics: inputs,
    kpis: calculateMieterstrom(inputs).kpis,
    facts: parsed.data.facts,
  });

  const step = evaluation.nextPaidStep;
  const body: EligibilityResponse = {
    ok: true,
    reference: parsed.data.reference ?? null,
    model: stamp(now),
    verdict: evaluation.verdict,
    verdictLabel: evaluation.verdictLabel,
    findings: evaluation.findings,
    missingData: evaluation.missingData,
    feasibility: evaluation.feasibility,
    valueDriver: evaluation.valueDriver,
    mainRisk: evaluation.mainRisk,
    estimatedEffort: evaluation.estimatedEffort,
    nextPaidStep: step
      ? {
          offerCode: step.offerCode,
          label: step.label,
          rationale: step.rationale,
          requiredData: PILOT_OFFER_FULFILLMENT[step.offerCode as PilotOfferCode].requiredData,
        }
      : null,
    disclaimer: API_DISCLAIMER_DE,
  };

  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).json(body);
}

export function handleMesskonzept(payload: unknown, res: ResultSink): void {
  const parsed = MesskonzeptRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return void apiV1Error(res, 400, "validation_error", "Ungültige Eingaben.", parsed.error.issues);
  }

  const now = new Date();
  const result = deriveMesskonzept(parsed.data.constellation);

  const body: MesskonzeptResponse = {
    ok: true,
    reference: parsed.data.reference ?? null,
    model: stamp(now),
    variant: result.variant,
    variantLabel: result.variantLabel,
    rationale: result.rationale,
    meters: result.meters,
    meterCount: result.meterCount,
    roles: result.roles,
    tasks: result.tasks,
    criticalPath: criticalPath(result),
    warnings: result.warnings,
    missingInputs: result.missingInputs,
    confidence: result.confidence,
    disclaimer: result.disclaimer,
  };

  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).json(body);
}

export function handleAllocation(payload: unknown, res: ResultSink): void {
  const parsed = AllocationRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return void apiV1Error(res, 400, "validation_error", "Ungültige Eingaben.", parsed.error.issues);
  }

  const { key, generationKwh, participants, includeSeries } = parsed.data;
  const options = { includeSeries };

  let runs: Partial<Record<AllocationKey, AllocationResult>>;
  try {
    runs = key
      ? { [key]: allocate({ key, generationKwh, participants }, options) }
      : compareKeys({ generationKwh, participants }, options);
  } catch (err) {
    // A shape the schema cannot express — mismatched series lengths, shares
    // over 100 %. Reported as the caller's input error, with its code.
    if (err instanceof AllocationError) {
      return void apiV1Error(res, 400, "unsupported_input", err.message, { code: err.code });
    }
    throw err;
  }

  const body: AllocationResponse = {
    ok: true,
    reference: parsed.data.reference ?? null,
    model: stamp(new Date()),
    key: key ?? null,
    runs: runs as Record<AllocationKey, AllocationResult>,
    recommendation: key ? null : recommendKey(runs as Record<AllocationKey, AllocationResult>),
  };

  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).json(body);
}

export function handleBilling(payload: unknown, res: ResultSink): void {
  const parsed = BillingRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return void apiV1Error(res, 400, "validation_error", "Ungültige Eingaben.", parsed.error.issues);
  }

  const { reference, ...input } = parsed.data;

  let result: ReturnType<typeof billPeriod>;
  try {
    result = billPeriod(input);
  } catch (err) {
    if (err instanceof BillingError) {
      return void apiV1Error(res, 400, "unsupported_input", err.message, { code: err.code });
    }
    throw err;
  }

  const body: BillingResponse = {
    ok: true,
    reference: reference ?? null,
    model: stamp(new Date()),
    period: result.period,
    days: result.days,
    vatRate: result.vatRate,
    statements: result.statements,
    totals: result.totals,
    priceCap: result.priceCap,
    // Re-checked from the produced result, not assumed from the code path.
    reconciliation: reconcile(result),
    missingData: result.missingData,
    warnings: result.warnings,
    conventions: result.conventions,
    disclaimer: result.disclaimer,
  };

  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).json(body);
}

export function handleGrid(payload: unknown, res: ResultSink): void {
  const parsed = MarketGridRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return void apiV1Error(res, 400, "validation_error", "Ungültige Eingaben.", parsed.error.issues);
  }

  try {
    const q = parsed.data;
    const grid =
      q.date !== undefined
        ? (() => {
            const g = dayGrid(q.date);
            return {
              from: g.date,
              to: g.date,
              intervals: g.intervals,
              days: [{ date: g.date, intervals: g.intervals, kind: g.kind }],
              startsUtcMs: g.startsUtcMs,
            };
          })()
        : (() => {
            const r = rangeGrid(q.from!, q.to!);
            return {
              from: r.from,
              to: r.to,
              intervals: r.intervals,
              days: r.days.map((d) => ({ date: d.date, intervals: d.intervals, kind: d.kind })),
              startsUtcMs: r.startsUtcMs,
            };
          })();

    const body: MarketGridResponse = {
      ok: true,
      model: stamp(new Date()),
      timezone: "Europe/Berlin",
      from: grid.from,
      to: grid.to,
      intervals: grid.intervals,
      days: grid.days,
      dstDays: grid.days
        .filter((d) => d.kind !== "normal")
        .map((d) => ({ date: d.date, intervals: d.intervals })),
      firstIntervalStart: edifact303(grid.startsUtcMs[0]),
      lastIntervalStart: edifact303(grid.startsUtcMs[grid.startsUtcMs.length - 1]),
    };

    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).json(body);
  } catch (err) {
    if (err instanceof MarketTimeError) {
      return void apiV1Error(res, 400, "unsupported_input", err.message, { code: err.code });
    }
    throw err;
  }
}

export function handleIdentifiers(payload: unknown, res: ResultSink): void {
  const parsed = IdentifierCheckRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return void apiV1Error(res, 400, "validation_error", "Ungültige Eingaben.", parsed.error.issues);
  }

  const result = validateMessageIdentifiers(parsed.data);
  const body: IdentifierCheckResponse = {
    ok: true,
    model: stamp(new Date()),
    valid: result.ok,
    results: result.results,
    problems: result.problems,
    algorithms: Object.values(CHECK_DIGIT_ALGORITHMS).map((a) => ({
      id: a.id,
      name: a.name,
      appliesTo: a.appliesTo,
      verified: a.verified,
      openQuestion: a.openQuestion ?? null,
    })),
  };

  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).json(body);
}

export function handleMscons(payload: unknown, res: ResultSink): void {
  const parsed = MsconsRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return void apiV1Error(res, 400, "validation_error", "Ungültige Eingaben.", parsed.error.issues);
  }

  const { reference, ...input } = parsed.data;

  let result: ReturnType<typeof buildMscons>;
  try {
    result = buildMscons(input);
  } catch (err) {
    // Wrong series length for a clock-change day, a malformed identifier, a
    // duplicated Messlokation: the caller's input, with the reason named.
    if (err instanceof MsconsError || err instanceof MarketTimeError) {
      return void apiV1Error(res, 400, "unsupported_input", err.message, { code: err.code });
    }
    throw err;
  }

  const body: MsconsResponse = {
    ok: true,
    reference: reference ?? null,
    model: stamp(new Date()),
    message: result.message,
    bytes: result.bytes,
    controlReference: result.controlReference,
    messageReference: result.messageReference,
    grid: result.grid,
    totals: result.totals,
    // Read back out of the produced message, not assumed.
    syntax: verifyInterchange(result.message),
    profile: {
      id: result.profile.id,
      messageType: result.profile.messageType,
      directory: result.profile.directory,
      associationCode: result.profile.associationCode,
      verified: result.profile.verified,
      openQuestion: result.profile.openQuestion ?? null,
    },
    warnings: result.warnings,
  };

  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).json(body);
}


// ============================================================================
// IN-PROCESS DISPATCH
// ============================================================================

/**
 * Run an endpoint without going over the network.
 *
 * The MCP server calls this. Routing a public endpoint's own request back
 * through HTTP would add a round trip and a failure mode for nothing, and —
 * worse — would make it possible for the two surfaces to diverge. They run the
 * same function.
 */
export function dispatchApiV1(
  endpoint: string,
  _method: "GET" | "POST",
  payload: unknown,
): { status: number; body: unknown } {
  const handler = HANDLER_BY_ENDPOINT[endpoint];
  if (!handler) {
    return {
      status: 404,
      body: { ok: false, code: "not_found", message: `Kein Endpunkt "${endpoint}".` },
    };
  }

  // Collects what the handler would have written to an Express response.
  let status = 200;
  let body: unknown = null;
  const sink: ResultSink = {
    status(code) {
      status = code;
      return sink;
    },
    json(value) {
      body = value;
      return sink;
    },
    setHeader() {
      /* headers are meaningless in-process */
    },
  };

  handler(payload, sink);
  return { status, body };
}

const HANDLER_BY_ENDPOINT: Record<ApiV1Endpoint, (payload: unknown, res: ResultSink) => void> = {
  [`${API_PREFIX}/meta`]: handleMeta,
  [`${API_PREFIX}/calculate`]: handleCalculate,
  [`${API_PREFIX}/eligibility`]: handleEligibility,
  [`${API_PREFIX}/messkonzept`]: handleMesskonzept,
  [`${API_PREFIX}/allocation`]: handleAllocation,
  [`${API_PREFIX}/billing`]: handleBilling,
  [`${MAKO_PREFIX}/grid`]: handleGrid,
  [`${MAKO_PREFIX}/identifiers`]: handleIdentifiers,
  [`${MAKO_PREFIX}/mscons`]: handleMscons,
};

export function mountApiV1(
  app: Express,
  deps: { limiter: RequestHandler },
): void {
  /** Bearer or X-API-Key. Same 401 whether the key is wrong or absent. */
  const requireKey: RequestHandler = (req, res, next) => {
    const identity = identifyApiKey(
      extractApiKey(req.headers as Record<string, string | string[] | undefined>),
    );
    if (!identity) {
      apiV1Error(res, 401, "unauthorized", "Ungültiger oder fehlender API-Schlüssel.");
      return;
    }
    (req as Request & { apiKey?: typeof identity }).apiKey = identity;
    res.setHeader("X-Api-Version", API_VERSION);
    next();
  };

  // --------------------------------------------------------------------------
  // GET /api/v1/meta — what this deployment computes, and how current it is
  // --------------------------------------------------------------------------
  app.get(`${API_PREFIX}/meta`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleMeta(req.query, res as unknown as ResultSink);
    },
  );

  app.post(`${API_PREFIX}/calculate`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleCalculate(req.body, res as unknown as ResultSink);
    },
  );

  app.post(`${API_PREFIX}/eligibility`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleEligibility(req.body, res as unknown as ResultSink);
    },
  );

  app.post(`${API_PREFIX}/messkonzept`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleMesskonzept(req.body, res as unknown as ResultSink);
    },
  );

  app.post(`${API_PREFIX}/allocation`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleAllocation(req.body, res as unknown as ResultSink);
    },
  );

  app.post(`${API_PREFIX}/billing`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleBilling(req.body, res as unknown as ResultSink);
    },
  );

  app.get(`${MAKO_PREFIX}/grid`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleGrid(req.query, res as unknown as ResultSink);
    },
  );

  app.post(`${MAKO_PREFIX}/identifiers`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleIdentifiers(req.body, res as unknown as ResultSink);
    },
  );

  app.post(`${MAKO_PREFIX}/mscons`, deps.limiter, requireKey, (req: Request, res: Response) => {
      handleMscons(req.body, res as unknown as ResultSink);
    },
  );

}
