/**
 * shared/schema.ts
 *
 * Single source of truth for every shape that crosses the wire between
 * client and server. Zod schemas double as runtime validators AND
 * TypeScript types via z.infer.
 *
 * Import this file from both client/src/lib/pilot-api.ts and server/index.ts.
 * Never duplicate these shapes anywhere else.
 *
 * Drop next to shared/const.ts. No tsconfig changes required as long as the
 * existing include patterns cover shared/.
 */

import { z } from "zod";

// ============================================================================
// PILOT OFFER CODES
// ============================================================================

export const PilotOfferCodeSchema = z.enum([
  "et_eligibility",
  "et_structuring",
  "et_mandate",
]);
export type PilotOfferCode = z.infer<typeof PilotOfferCodeSchema>;

export function isPilotOfferCode(value: unknown): value is PilotOfferCode {
  return PilotOfferCodeSchema.safeParse(value).success;
}

// ============================================================================
// PROJECT TYPES (must match the <option> values in PilotCheckoutForm)
// ============================================================================

export const ProjectTypeSchema = z.enum([
  "gebaeude",
  "quartier",
  "portfolio",
  "kommunal",
  "infrastruktur",
]);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  gebaeude: "Gebäude oder einzelner Standort",
  quartier: "Quartier oder Areal",
  portfolio: "Portfolio oder Mehrstandort-Konstellation",
  kommunal: "Kommunale oder institutionelle Konstellation",
  infrastruktur: "Betriebs- oder Infrastrukturvorhaben",
};

// ============================================================================
// LEGAL ACCEPTANCES
// ============================================================================

export const LegalAcceptancesSchema = z.object({
  privacyPolicyAccepted: z.boolean().refine((v) => v === true, {
    message: "Bitte bestätigen Sie die Datenschutzhinweise.",
  }),
  pilotTermsAccepted: z.boolean().refine((v) => v === true, {
    message: "Bitte bestätigen Sie die Pilotbedingungen.",
  }),
  marketingConsent: z.boolean().optional().default(false),
});
export type LegalAcceptances = z.infer<typeof LegalAcceptancesSchema>;

// ============================================================================
// PILOT CHECKOUT — request & response
// ============================================================================

export const CreatePilotCheckoutInputSchema = z.object({
  offerCode: PilotOfferCodeSchema,
  projectType: ProjectTypeSchema,
  name: z
    .string()
    .trim()
    .min(2, "Bitte geben Sie einen Ansprechpartner mit mindestens 2 Zeichen an.")
    .max(120, "Name ist zu lang."),
  email: z
    .string()
    .trim()
    .email("Bitte geben Sie eine gültige E-Mail-Adresse an.")
    .max(200, "E-Mail ist zu lang."),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  organization: z.string().trim().max(200).optional().or(z.literal("")),
  location: z
    .string()
    .trim()
    .min(2, "Bitte geben Sie den Projektstandort oder die Region an.")
    .max(200, "Standortangabe ist zu lang."),
  legalAcceptances: LegalAcceptancesSchema,
  /**
   * Honeypot — must be empty. Bots fill it; humans don't.
   * Server rejects any submission with a non-empty value.
   */
  website: z.string().max(0, "spam_detected").optional().default(""),
});
export type CreatePilotCheckoutInput = z.infer<typeof CreatePilotCheckoutInputSchema>;

export const PilotCheckoutStageSchema = z.literal("checkout_created");
export type PilotCheckoutStage = z.infer<typeof PilotCheckoutStageSchema>;

export const CreatePilotCheckoutResultSchema = z.object({
  ok: z.literal(true),
  checkoutUrl: z.string().url(),
  sessionId: z.string().min(1),
  offerCode: PilotOfferCodeSchema,
  offerLabel: z.string(),
  projectType: ProjectTypeSchema,
  currency: z.string(),
  stage: PilotCheckoutStageSchema,
});
export type CreatePilotCheckoutResult = z.infer<typeof CreatePilotCheckoutResultSchema>;

// ============================================================================
// LEAD CAPTURE (Mieterstrom-Rechner and future free tools)
// ============================================================================

export const LeadSourceSchema = z.enum([
  "rechner-mieterstrom-rendite",
  "rechner-energy-sharing-allokation",
  "newsletter",
  "contact-form",
]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const MieterstromInputsSchema = z.object({
  kwp: z.number().positive().max(2000),
  anzahlWohneinheiten: z.number().int().positive().max(2000),
  eigenverbrauchsquote: z.number().min(0).max(1),
  strompreisMieterCtPerKwh: z.number().positive().max(200),
  mieterstromZuschlagCtPerKwh: z.number().nonnegative().max(50),
  einspeiseverguetungCtPerKwh: z.number().nonnegative().max(50),
  investitionEurPerKwp: z.number().positive().max(5000),
  betriebskostenEurPerKwpJahr: z.number().nonnegative().max(500),
  laufzeitJahre: z.number().int().positive().max(40),
  diskontierungssatz: z.number().min(0).max(0.5),
  degradationPctPerJahr: z.number().min(0).max(0.05),
  spezifischerErtragKwhPerKwp: z.number().positive().max(2000),
});
export type MieterstromInputs = z.infer<typeof MieterstromInputsSchema>;

export const MieterstromKpisSchema = z.object({
  investitionEur: z.number(),
  amortisationsdauerJahre: z.number().nullable(),
  npvEur: z.number(),
  irrPct: z.number().nullable(),
  erlosKumEur: z.number(),
  co2EinsparungT: z.number(),
});
export type MieterstromKpis = z.infer<typeof MieterstromKpisSchema>;

export const LeadCaptureInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Bitte geben Sie eine gültige E-Mail-Adresse an.")
    .max(200),
  source: LeadSourceSchema,
  payload: z
    .object({
      inputs: MieterstromInputsSchema.partial().optional(),
      kpis: MieterstromKpisSchema.partial().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  consent: z.boolean().refine((v) => v === true, {
    message: "Einwilligung erforderlich.",
  }),
  /** Honeypot — must be empty. */
  website: z.string().max(0).optional().default(""),
});
export type LeadCaptureInput = z.infer<typeof LeadCaptureInputSchema>;

export const LeadCaptureResultSchema = z.object({
  ok: z.literal(true),
  leadId: z.string().min(1),
});
export type LeadCaptureResult = z.infer<typeof LeadCaptureResultSchema>;

// ============================================================================
// UNIFIED API ERROR ENVELOPE
// ============================================================================

export const ApiErrorCodeSchema = z.enum([
  "validation_error",
  "rate_limited",
  "not_found",
  "internal_error",
  "stripe_error",
  "spam_detected",
  "config_missing",
  "method_not_allowed",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: ApiErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Generic API result. Use as the response type for any endpoint:
 *   ApiResult<CreatePilotCheckoutResult>
 *   = ({ ok: true } & CreatePilotCheckoutResult) | ApiError
 */
export type ApiResult<T> = ({ ok: true } & T) | ApiError;

// ============================================================================
// SERVER-SIDE PILOT OFFER CONFIG
// ----------------------------------------------------------------------------
// This map IS the source of truth for which offer maps to which Stripe price.
// It is referenced only by server/index.ts; the client never reads pricing.
//
// To launch:
//   1. Create three Stripe Products + Prices in your Stripe dashboard.
//   2. Copy each Price ID into the corresponding environment variable below.
//   3. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.
//   4. Deploy.
// ============================================================================

export type PilotOfferServerConfig = {
  code: PilotOfferCode;
  label: string;
  stripePriceEnvVar: string;
  currency: "eur";
};

export const PILOT_OFFER_SERVER_CONFIG: Record<PilotOfferCode, PilotOfferServerConfig> = {
  et_eligibility: {
    code: "et_eligibility",
    label: "Pilot Eligibility Check",
    stripePriceEnvVar: "STRIPE_PRICE_ET_ELIGIBILITY",
    currency: "eur",
  },
  et_structuring: {
    code: "et_structuring",
    label: "Pilot Structuring Package",
    stripePriceEnvVar: "STRIPE_PRICE_ET_STRUCTURING",
    currency: "eur",
  },
  et_mandate: {
    code: "et_mandate",
    label: "Full Pilot Preparation Mandate",
    stripePriceEnvVar: "STRIPE_PRICE_ET_MANDATE",
    currency: "eur",
  },
};
