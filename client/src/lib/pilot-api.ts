/**
 * client/src/lib/pilot-api.ts
 *
 * The single import point for the client to talk to the server.
 *
 * Design rules:
 *   - Every server response is parsed with a Zod schema from shared/schema.ts.
 *     We never trust the wire even when we wrote the server.
 *   - The marketing content (titles, badges, outcomes) stays client-side.
 *     Only the *price* lives on the server (implementation_brief.md rule).
 *   - Existing consumers (PilotOfferCards, PilotCheckoutForm, Home) keep
 *     working without code changes — the public API is preserved.
 *   - submitLead() is new, used by the Mieterstrom-Rechner. Same shape and
 *     fallback semantics as the inline version that ships in Home.tsx today.
 *
 * Import path note: shared/schema.ts is at the repo root. From this file
 * (client/src/lib/pilot-api.ts) the relative path is ../../../shared/schema.
 */

import {
  ApiErrorSchema,
  CreatePilotCheckoutInputSchema,
  CreatePilotCheckoutResultSchema,
  LeadCaptureInputSchema,
  LeadCaptureResultSchema,
  type ApiError,
  type CreatePilotCheckoutInput,
  type CreatePilotCheckoutResult,
  type LeadCaptureInput,
  type LeadCaptureResult,
  type LeadSource,
  type MieterstromInputs,
  type MieterstromKpis,
  type PilotOfferCode,
  type ProjectType,
} from "../../../shared/schema";

// Re-export the public types so other client files can keep
// `import { PilotOfferCode } from "@/lib/pilot-api"` working.
export type {
  ApiError,
  CreatePilotCheckoutInput,
  CreatePilotCheckoutResult,
  LeadCaptureInput,
  LeadCaptureResult,
  LeadSource,
  MieterstromInputs,
  MieterstromKpis,
  PilotOfferCode,
  ProjectType,
};

// Re-export legacy alias for back-compat. Pre-rewrite consumers imported this.
export type PilotCheckoutStage = "checkout_created";
export type PilotCheckoutLegalAcceptances = {
  privacyPolicyAccepted?: boolean;
  pilotTermsAccepted?: boolean;
  marketingConsent?: boolean;
};

// ============================================================================
// ERROR CLASS — preserved API
// ============================================================================

export type PilotApiErrorPayload = {
  ok?: false;
  error?: string;
  code?: string;
  message?: string;
};

export class PilotApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: PilotApiErrorPayload | null;

  constructor(
    message: string,
    options: { status: number; code?: string; payload?: PilotApiErrorPayload | null },
  ) {
    super(message);
    this.name = "PilotApiError";
    this.status = options.status;
    this.code = options.code || "pilot_api_error";
    this.payload = options.payload ?? null;
  }
}

// ============================================================================
// LOW-LEVEL FETCH WRAPPER
// ============================================================================

async function parseJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function throwTypedError(response: Response, payload: unknown): never {
  // First try to parse the server's typed error envelope.
  const parsedError = ApiErrorSchema.safeParse(payload);
  if (parsedError.success) {
    throw new PilotApiError(parsedError.data.message, {
      status: response.status,
      code: parsedError.data.code,
      payload: parsedError.data,
    });
  }
  // Fall back to legacy shape (the pre-rewrite server used a looser format).
  const loose = (payload && typeof payload === "object" ? payload : {}) as PilotApiErrorPayload;
  throw new PilotApiError(
    loose.message || loose.error || "Die Anfrage konnte nicht verarbeitet werden.",
    {
      status: response.status,
      code: loose.code || loose.error || "pilot_api_error",
      payload: loose,
    },
  );
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal },
): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  const payload = await parseJsonSafely(response);
  if (!response.ok) throwTypedError(response, payload);
  return payload;
}

// ============================================================================
// PUBLIC API — checkout
// ============================================================================

export async function createPilotCheckout(
  input: CreatePilotCheckoutInput,
  options?: { signal?: AbortSignal },
): Promise<CreatePilotCheckoutResult> {
  // Validate INPUT before the wire — catches bugs in the calling form.
  const parsedInput = CreatePilotCheckoutInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new PilotApiError(
      parsedInput.error.issues[0]?.message ?? "Ungültige Eingaben.",
      { status: 400, code: "validation_error" },
    );
  }

  const raw = await postJson("/api/pilot-checkout", parsedInput.data, options);

  // Validate OUTPUT — never trust the server response shape.
  const parsedOutput = CreatePilotCheckoutResultSchema.safeParse(raw);
  if (!parsedOutput.success) {
    throw new PilotApiError("Antwort vom Server konnte nicht verarbeitet werden.", {
      status: 500,
      code: "invalid_response",
      payload: { message: "Schema validation failed on /api/pilot-checkout response." },
    });
  }
  return parsedOutput.data;
}

// ============================================================================
// PUBLIC API — lead capture (Mieterstrom-Rechner & future free tools)
// ============================================================================

/**
 * Submit a lead to the server.
 *
 * Fallback: if the network/server is unavailable, the lead is queued in
 * localStorage under "et:leads:pending" so it's never lost. The caller can
 * treat the queued state as success from a UX perspective; on the next
 * deployment with a working server, you can flush the queue manually.
 */
export async function submitLead(
  input: LeadCaptureInput,
  options?: { signal?: AbortSignal },
): Promise<{ ok: true; leadId: string; persisted: "server" | "local" }> {
  const parsedInput = LeadCaptureInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new PilotApiError(
      parsedInput.error.issues[0]?.message ?? "Ungültige Eingaben.",
      { status: 400, code: "validation_error" },
    );
  }

  try {
    const raw = await postJson("/api/lead", parsedInput.data, options);
    const parsed = LeadCaptureResultSchema.safeParse(raw);
    if (parsed.success) {
      return { ok: true, leadId: parsed.data.leadId, persisted: "server" };
    }
    // schema mismatch — fall through to local fallback rather than losing the lead
  } catch (err) {
    // network error or 5xx — fall through
    if ((err as { name?: string })?.name === "AbortError") throw err;
  }

  // Local fallback. Never lose a lead.
  const localId = generateLocalId();
  try {
    const key = "et:leads:pending";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    existing.push({
      leadId: localId,
      ts: new Date().toISOString(),
      input: parsedInput.data,
    });
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // localStorage may be disabled in some browser modes; nothing more we can do.
  }
  return { ok: true, leadId: localId, persisted: "local" };
}

function generateLocalId(): string {
  // crypto.randomUUID is available in modern browsers; fall back if not.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================================
// CLIENT-SIDE MARKETING CONTENT (titles, subtitles, outcomes)
// ----------------------------------------------------------------------------
// This stays on the client deliberately. It's display copy, not pricing.
// Pricing lives only on the server in PILOT_OFFER_SERVER_CONFIG.
// ============================================================================

export const pilotOfferContent: Record<
  PilotOfferCode,
  {
    title: string;
    badge: string;
    subtitle: string;
    outcomes: string[];
    idealFor: string;
    priority: string;
  }
> = {
  et_eligibility: {
    title: "Pilot Eligibility Check",
    badge: "Schneller Einstieg",
    subtitle:
      "Die schnellste bezahlte Einordnung für Standorte, Gebäude, Quartiere und erste Betreiberkonstellationen.",
    outcomes: [
      "Erste professionelle Qualifizierung der Konstellation",
      "Einordnung der Ausgangslage für Beteiligte und nächste Schritte",
      "Saubere Grundlage für die Entscheidung über Vertiefung oder Mandat",
    ],
    idealFor:
      "Eigentümer, Projektträger und kommunale Akteure mit einer ersten konkreten Konstellation.",
    priority: "Fastest path to paid project qualification.",
  },
  et_structuring: {
    title: "Pilot Structuring Package",
    badge: "Empfohlener Standard",
    subtitle:
      "Die vertiefte Strukturierungsstufe für Projekte, in denen Rollen, Dokumente und Entscheidungsfähigkeit sauber vorbereitet werden müssen.",
    outcomes: [
      "Vertiefte Struktur für Standort, Stakeholder und Projektlogik",
      "Bessere Arbeitsgrundlage für Dokumente, Gespräche und Koordination",
      "Klare nächste operative Schritte statt unverbundener Einzelinformationen",
    ],
    idealFor:
      "Komplexere Projekte mit mehreren Rollen, Datenquellen oder Abstimmungsbedarf.",
    priority: "Best default offer for serious project leads.",
  },
  et_mandate: {
    title: "Full Pilot Preparation Mandate",
    badge: "Höchste Begleitung",
    subtitle:
      "Die intensivste Stufe für Vorhaben, die mit höherer Verbindlichkeit, höherem Koordinationsaufwand und klarer Umsetzungsnähe vorbereitet werden sollen.",
    outcomes: [
      "Hochpriorisierte Vorbereitung der Projektgrundlage",
      "Tiefere operative Begleitung der Einordnung und Unterlagenlage",
      "Strukturierte Basis für Folgegespräche, Partnerabstimmung und Umsetzungsschritte",
    ],
    idealFor:
      "Portfolios, Quartiere und Vorhaben mit echter Umsetzungsabsicht oder institutionellem Druck.",
    priority: "Highest-value path for enterprise-grade project preparation.",
  },
};

export function isPilotOfferCodeStr(value: string): value is PilotOfferCode {
  return value === "et_eligibility" || value === "et_structuring" || value === "et_mandate";
}

export function getPilotOfferContent(offerCode: PilotOfferCode) {
  return pilotOfferContent[offerCode];
}

export function getPilotOfferOptions() {
  return (Object.keys(pilotOfferContent) as PilotOfferCode[]).map((offerCode) => ({
    offerCode,
    ...pilotOfferContent[offerCode],
  }));
}
