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
