/**
 * shared/api-contract.ts
 *
 * Public computation API, v1.
 *
 * The same deterministic engine the website runs, exposed under a key so a
 * Stadtwerk, EPC or platform can put qualification inside their own process.
 *
 * What every response carries, and what makes it worth integrating:
 *
 *   - `model` — model version, assumption set, jurisdiction and currency, so a
 *     result can be reproduced exactly and two results can be compared only
 *     when they are comparable.
 *   - `provenance` — per input: its source class, whether it is verified, and
 *     the customer-supplied vs default distinction. A caller can show an owner
 *     or a bank where each number came from.
 *   - `freshness` — the validity window of every regulated rate used, so an
 *     integrator can tell whether the answer is still current.
 *
 * Nothing in this contract is generated text. Every field is computed, and the
 * engine refuses to answer rather than guess when an input is out of range.
 */

import { z } from "zod";
import { MieterstromInputsSchema } from "./schema.js";
import { QualificationFactsSchema, EligibilityVerdictSchema } from "./eligibility.js";
import { MesskonzeptInputSchema, MesskonzeptVariantSchema } from "./messkonzept.js";
import { AllocationKeySchema, ParticipantSchema } from "./allocation.js";
import {
  BillingParticipantSchema,
  BillingPeriodSchema,
  TariffSchema,
} from "./billing.js";

/** Bumped only for a breaking change to request or response shape. */
export const API_VERSION = "1.0.0";

/** Path prefix. Versioned so v1 can keep working when v2 exists. */
export const API_PREFIX = "/api/v1";

// ============================================================================
// ENVELOPE
// ============================================================================

export const ApiModelStampSchema = z.object({
  apiVersion: z.string(),
  modelVersion: z.string(),
  assumptionSet: z.string(),
  jurisdiction: z.literal("DE"),
  currency: z.literal("EUR"),
  calculatedAt: z.string(),
});
export type ApiModelStamp = z.infer<typeof ApiModelStampSchema>;

export const FreshnessEntrySchema = z.object({
  status: z.enum(["current", "expiring", "expired", "open_ended"]),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
  daysRemaining: z.number().int().nullable(),
});

export const ProvenanceEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  value: z.number(),
  source: z.string(),
  sourceLabel: z.string(),
  verified: z.boolean(),
});
export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;

// ============================================================================
// ERRORS
// ============================================================================

export const ApiV1ErrorCodeSchema = z.enum([
  "unauthorized",
  "rate_limited",
  "validation_error",
  "unsupported_input",
  "internal_error",
]);
export type ApiV1ErrorCode = z.infer<typeof ApiV1ErrorCodeSchema>;

export const ApiV1ErrorSchema = z.object({
  ok: z.literal(false),
  code: ApiV1ErrorCodeSchema,
  message: z.string(),
  /** Machine-readable detail. Field paths for validation, names for the rest. */
  details: z.unknown().optional(),
});
export type ApiV1Error = z.infer<typeof ApiV1ErrorSchema>;

// ============================================================================
// CALCULATE
// ============================================================================

export const CalculateRequestSchema = z.object({
  /**
   * Full input set. Any field omitted falls back to the sourced default for
   * the given plant size; the response's provenance says which is which.
   */
  inputs: MieterstromInputsSchema.partial().and(
    z.object({ kwp: z.number().positive().max(2000) }),
  ),
  /** Include the year-by-year schedule. Off by default to keep payloads small. */
  includeSchedule: z.boolean().optional().default(false),
  /** Caller's own project id, echoed back for reconciliation. Never stored. */
  reference: z.string().max(120).optional(),
});
export type CalculateRequest = z.infer<typeof CalculateRequestSchema>;

export const ScenarioKpisSchema = z.object({
  investitionEur: z.number(),
  amortisationsdauerJahre: z.number().nullable(),
  npvEur: z.number(),
  irrPct: z.number().nullable(),
  erlosKumEur: z.number(),
  co2EinsparungT: z.number(),
});

export const ScheduleYearSchema = z.object({
  jahr: z.number().int(),
  ertragKwh: z.number(),
  eigenverbrauchKwh: z.number(),
  einspeisungKwh: z.number(),
  cashflowEur: z.number(),
  kumulierterCashflowEur: z.number(),
});

export const CalculateResponseSchema = z.object({
  ok: z.literal(true),
  reference: z.string().nullable(),
  model: ApiModelStampSchema,
  /** Three scenarios, as the website computes them. */
  scenarios: z.object({
    konservativ: ScenarioKpisSchema,
    realistisch: ScenarioKpisSchema,
    optimistisch: ScenarioKpisSchema,
  }),
  /** Present only when includeSchedule was true. Realistic scenario. */
  schedule: z.array(ScheduleYearSchema).nullable(),
  /** The effective inputs used, with where each value came from. */
  provenance: z.array(ProvenanceEntrySchema),
  /** Validity window of every regulated rate involved. */
  freshness: z.record(z.string(), FreshnessEntrySchema),
  /** Which participation model these figures describe, and which they do not. */
  coverage: z.string(),
  /** Non-fatal notes: regime horizon, price cap, out-of-band sizes. */
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});
export type CalculateResponse = z.infer<typeof CalculateResponseSchema>;

// ============================================================================
// ELIGIBILITY
// ============================================================================

export const EligibilityRequestSchema = z.object({
  inputs: MieterstromInputsSchema.partial().and(
    z.object({ kwp: z.number().positive().max(2000) }),
  ),
  facts: QualificationFactsSchema.optional(),
  reference: z.string().max(120).optional(),
});
export type EligibilityRequest = z.infer<typeof EligibilityRequestSchema>;

export const EligibilityResponseSchema = z.object({
  ok: z.literal(true),
  reference: z.string().nullable(),
  model: ApiModelStampSchema,
  verdict: EligibilityVerdictSchema,
  verdictLabel: z.string(),
  findings: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["blocker", "review", "info", "missing"]),
      message: z.string(),
    }),
  ),
  missingData: z.array(z.string()),
  feasibility: z.string(),
  valueDriver: z.string(),
  mainRisk: z.string(),
  estimatedEffort: z.enum(["gering", "mittel", "hoch"]),
  nextPaidStep: z
    .object({
      offerCode: z.string(),
      label: z.string(),
      rationale: z.string(),
      requiredData: z.array(z.string()),
    })
    .nullable(),
  /**
   * Stated on every eligibility response. The engine reports economic and
   * structural preconditions; it does not assess legal admissibility.
   */
  disclaimer: z.string(),
});
export type EligibilityResponse = z.infer<typeof EligibilityResponseSchema>;

export const API_DISCLAIMER_DE =
  "Diese Einordnung betrifft ausschließlich wirtschaftliche und strukturelle Voraussetzungen. Sie trifft keine Aussage über die rechtliche Zulässigkeit und ersetzt keine fachliche Prüfung.";

// ============================================================================
// META
// ============================================================================

export const MetaResponseSchema = z.object({
  ok: z.literal(true),
  model: ApiModelStampSchema,
  /** Every regulated rate table with its bands, basis and validity window. */
  rates: z.record(
    z.string(),
    z.object({
      bands: z.array(z.object({ maxKwp: z.number(), ctPerKwh: z.number() })),
      legalBasis: z.string(),
      validFrom: z.string(),
      validUntil: z.string().nullable(),
      verified: z.boolean(),
      freshness: FreshnessEntrySchema,
    }),
  ),
  /** The three participation models, and which one the engine computes. */
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      scope: z.string(),
      computed: z.boolean(),
      /** Null while the citation is unverified. */
      citation: z.string().nullable(),
    }),
  ),
  endpoints: z.array(z.string()),
});
export type MetaResponse = z.infer<typeof MetaResponseSchema>;

// ============================================================================
// MESSKONZEPT
// ============================================================================

export const MesskonzeptRequestSchema = z.object({
  constellation: MesskonzeptInputSchema,
  reference: z.string().max(120).optional(),
});
export type MesskonzeptRequest = z.infer<typeof MesskonzeptRequestSchema>;

export const MeterSpecSchema = z.object({
  code: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  bidirectional: z.boolean(),
  intervalMetering: z.boolean(),
  purpose: z.string(),
});

export const MarketRoleSchema = z.object({
  code: z.string(),
  label: z.string(),
  filledBy: z.string(),
  responsibility: z.string(),
});

export const MesskonzeptTaskSchema = z.object({
  code: z.string(),
  title: z.string(),
  owner: z.string(),
  blocking: z.boolean(),
});

export const MesskonzeptResponseSchema = z.object({
  ok: z.literal(true),
  reference: z.string().nullable(),
  model: ApiModelStampSchema,
  variant: MesskonzeptVariantSchema,
  variantLabel: z.string(),
  rationale: z.string(),
  meters: z.array(MeterSpecSchema),
  meterCount: z.number().int().nonnegative(),
  roles: z.array(MarketRoleSchema),
  tasks: z.array(MesskonzeptTaskSchema),
  /** Blocking tasks only, in order. */
  criticalPath: z.array(MesskonzeptTaskSchema),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  missingInputs: z.array(z.string()),
  confidence: z.enum(["high", "medium", "insufficient_data"]),
  /** The network operator's approval is authoritative; this is a proposal. */
  disclaimer: z.string(),
});
export type MesskonzeptResponse = z.infer<typeof MesskonzeptResponseSchema>;

// ============================================================================
// ALLOCATION
// ============================================================================

export const AllocationRequestSchema = z.object({
  /** Omit to run all three keys and return the comparison. */
  key: AllocationKeySchema.optional(),
  generationKwh: z.array(z.number().min(0)).min(1).max(35_040),
  participants: z.array(ParticipantSchema).min(1).max(500),
  /** Return per-interval series as well as totals. Off by default. */
  includeSeries: z.boolean().optional().default(false),
  reference: z.string().max(120).optional(),
});
export type AllocationRequest = z.infer<typeof AllocationRequestSchema>;

export const ParticipantAllocationSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  share: z.number().nullable(),
  consumptionKwh: z.number(),
  allocatedKwh: z.number(),
  gridDrawKwh: z.number(),
  coverageRate: z.number().nullable(),
  series: z.array(z.number()).nullable(),
});

export const AllocationTotalsSchema = z.object({
  generationKwh: z.number(),
  consumptionKwh: z.number(),
  allocatedKwh: z.number(),
  feedInKwh: z.number(),
  gridDrawKwh: z.number(),
  selfConsumptionRate: z.number(),
  autarkyRate: z.number(),
  intervals: z.number().int(),
  intervalMinutes: z.number().int(),
});

export const AllocationRunSchema = z.object({
  key: AllocationKeySchema,
  keyLabel: z.string(),
  keyDescription: z.string(),
  participants: z.array(ParticipantAllocationSchema),
  totals: AllocationTotalsSchema,
  generationSeries: z.array(z.number()).nullable(),
  feedInSeries: z.array(z.number()).nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  disclaimer: z.string(),
});

export const AllocationResponseSchema = z.object({
  ok: z.literal(true),
  reference: z.string().nullable(),
  model: ApiModelStampSchema,
  /** The requested key, or null when all three were run. */
  key: AllocationKeySchema.nullable(),
  /** Keyed by allocation key. One entry for a single run, three for a comparison. */
  runs: z.record(AllocationKeySchema, AllocationRunSchema),
  /**
   * Which key placed the most energy with participants, and how much more than
   * the worst. Present only for a comparison.
   */
  recommendation: z
    .object({
      key: AllocationKeySchema,
      keyLabel: z.string(),
      additionalSelfConsumptionKwh: z.number(),
      additionalSelfConsumptionPoints: z.number(),
      comparedTo: AllocationKeySchema,
    })
    .nullable(),
});
export type AllocationResponse = z.infer<typeof AllocationResponseSchema>;

// ============================================================================
// BILLING
// ============================================================================

export const BillingRequestSchema = z.object({
  period: BillingPeriodSchema,
  tariff: TariffSchema,
  participants: z.array(BillingParticipantSchema).min(1).max(2000),
  vatRate: z.number().min(0).max(1).optional(),
  reference: z.string().max(120).optional(),
});
export type BillingRequest = z.infer<typeof BillingRequestSchema>;

export const StatementLineSchema = z.object({
  code: z.string(),
  label: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPriceCt: z.number(),
  netCents: z.number().int(),
});

export const ParticipantStatementSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  unitLabel: z.string().nullable(),
  meterNumber: z.string().nullable(),
  lines: z.array(StatementLineSchema),
  netCents: z.number().int(),
  vatCents: z.number().int(),
  grossCents: z.number().int(),
  prepaidCents: z.number().int(),
  balanceCents: z.number().int(),
  consumptionKwh: z.number(),
  sharedShare: z.number().nullable(),
  savingVsGrundversorgungCents: z.number().int().nullable(),
});

export const BillingResponseSchema = z.object({
  ok: z.literal(true),
  reference: z.string().nullable(),
  model: ApiModelStampSchema,
  period: BillingPeriodSchema,
  days: z.number().int(),
  vatRate: z.number(),
  statements: z.array(ParticipantStatementSchema),
  totals: z.object({
    participants: z.number().int(),
    allocatedKwh: z.number(),
    gridDrawKwh: z.number(),
    consumptionKwh: z.number(),
    netCents: z.number().int(),
    vatCents: z.number().int(),
    grossCents: z.number().int(),
    prepaidCents: z.number().int(),
    balanceCents: z.number().int(),
    savingVsGrundversorgungCents: z.number().int().nullable(),
  }),
  priceCap: z.object({
    status: z.enum(["ok", "over_cap", "unknown"]),
    capCtPerKwh: z.number().nullable(),
  }),
  /**
   * The identities the engine guarantees, re-checked from the response itself
   * so an integrator can assert the statement adds up without trusting us.
   */
  reconciliation: z.object({
    ok: z.boolean(),
    failures: z.array(z.object({ code: z.string(), detail: z.string() })),
  }),
  missingData: z.array(z.string()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  conventions: z.array(z.string()),
  disclaimer: z.string(),
});
export type BillingResponse = z.infer<typeof BillingResponseSchema>;

// ============================================================================
// MARKTKOMMUNIKATION
// ============================================================================

export const MAKO_PREFIX = `${API_PREFIX}/mako`;

export const MarketGridRequestSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => (v.date !== undefined) !== (v.from !== undefined && v.to !== undefined), {
    message: "Entweder ein Datum oder ein Zeitraum aus from und to angeben.",
  });
export type MarketGridRequest = z.infer<typeof MarketGridRequestSchema>;

export const MarketGridResponseSchema = z.object({
  ok: z.literal(true),
  model: ApiModelStampSchema,
  timezone: z.literal("Europe/Berlin"),
  from: z.string(),
  to: z.string(),
  /** Real interval count. Not days x 96. */
  intervals: z.number().int(),
  days: z.array(
    z.object({
      date: z.string(),
      intervals: z.number().int(),
      kind: z.enum(["normal", "dst_short", "dst_long"]),
    }),
  ),
  /** Days in the range that are not 96 intervals long. */
  dstDays: z.array(z.object({ date: z.string(), intervals: z.number().int() })),
  /** First and last interval start, as EDIFACT format 303. */
  firstIntervalStart: z.string(),
  lastIntervalStart: z.string(),
});
export type MarketGridResponse = z.infer<typeof MarketGridResponseSchema>;

export const IdentifierCheckRequestSchema = z.object({
  senderCode: z.string().max(64),
  receiverCode: z.string().max(64),
  malo: z.string().max(64).optional(),
  melo: z.string().max(64).optional(),
  balancingAreaEic: z.string().max(64).optional(),
});
export type IdentifierCheckRequest = z.infer<typeof IdentifierCheckRequestSchema>;

export const IdValidationSchema = z.object({
  value: z.string(),
  format: z.enum(["ok", "invalid"]),
  /**
   * Never "ok" while the check-digit algorithm is unverified — the same gate
   * the statutory citations use.
   */
  checkDigit: z.enum(["ok", "mismatch", "algorithm_unverified"]),
  computed: z.string().nullable(),
  problems: z.array(z.string()),
});

export const IdentifierCheckResponseSchema = z.object({
  ok: z.literal(true),
  model: ApiModelStampSchema,
  valid: z.boolean(),
  results: z.record(z.string(), IdValidationSchema),
  problems: z.array(z.string()),
  algorithms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      appliesTo: z.string(),
      verified: z.boolean(),
      openQuestion: z.string().nullable(),
    }),
  ),
});
export type IdentifierCheckResponse = z.infer<typeof IdentifierCheckResponseSchema>;

export const MsconsRequestSchema = z.object({
  period: z.union([
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ]),
  sender: z.object({ code: z.string().max(64), qualifier: z.string().max(8).optional() }),
  receiver: z.object({ code: z.string().max(64), qualifier: z.string().max(8).optional() }),
  locations: z
    .array(
      z.object({
        melo: z.string().max(64),
        malo: z.string().max(64).optional(),
        direction: z.enum(["consumption", "feed_in"]),
        valuesKwh: z.array(z.number().min(0)).min(1).max(35_040),
        statuses: z.array(z.enum(["measured", "substituted", "estimated"])).optional(),
      }),
    )
    .min(1)
    .max(200),
  controlReference: z.string().max(14).optional(),
  messageReference: z.string().max(14).optional(),
  test: z.boolean().optional(),
  reference: z.string().max(120).optional(),
});
export type MsconsRequest = z.infer<typeof MsconsRequestSchema>;

export const MsconsResponseSchema = z.object({
  ok: z.literal(true),
  reference: z.string().nullable(),
  model: ApiModelStampSchema,
  /** The interchange, ready to hand to a transport. */
  message: z.string(),
  bytes: z.number().int(),
  controlReference: z.string(),
  messageReference: z.string(),
  grid: z.object({
    intervals: z.number().int(),
    from: z.string(),
    to: z.string(),
    dstDays: z.array(z.object({ date: z.string(), intervals: z.number().int() })),
  }),
  totals: z.array(
    z.object({
      melo: z.string(),
      direction: z.enum(["consumption", "feed_in"]),
      kwh: z.number(),
      values: z.number().int(),
    }),
  ),
  /**
   * Syntax integrity re-checked from the produced message: segment counts and
   * control references read back out, not assumed from the code path.
   */
  syntax: z.object({
    ok: z.boolean(),
    messageCount: z.number().int(),
    findings: z.array(z.object({ code: z.string(), message: z.string() })),
  }),
  /** Message type, directory and whether the segment usage is verified. */
  profile: z.object({
    id: z.string(),
    messageType: z.string(),
    directory: z.object({ version: z.string(), release: z.string(), agency: z.string() }),
    associationCode: z.string(),
    verified: z.boolean(),
    openQuestion: z.string().nullable(),
  }),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});
export type MsconsResponse = z.infer<typeof MsconsResponseSchema>;

// ============================================================================
// THE ENDPOINT REGISTER
// ============================================================================

/**
 * Every computation the v1 API exposes, named once.
 *
 * Three surfaces describe the same set: the HTTP routes, the MCP tool list and
 * the published OpenAPI document. Naming the set here — in a module all three
 * already depend on — means a new endpoint that is not wired into all of them
 * fails a test rather than shipping as an endpoint an agent is told about and
 * cannot call, or can call and was never told about.
 */
export const API_V1_ENDPOINTS = [
  `${API_PREFIX}/meta`,
  `${API_PREFIX}/calculate`,
  `${API_PREFIX}/eligibility`,
  `${API_PREFIX}/messkonzept`,
  `${API_PREFIX}/allocation`,
  `${API_PREFIX}/billing`,
  `${MAKO_PREFIX}/grid`,
  `${MAKO_PREFIX}/identifiers`,
  `${MAKO_PREFIX}/mscons`,
] as const;

export type ApiV1Endpoint = (typeof API_V1_ENDPOINTS)[number];
