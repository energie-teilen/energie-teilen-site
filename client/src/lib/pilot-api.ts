export type PilotOfferCode = "et_eligibility" | "et_structuring" | "et_mandate";

export type PilotCheckoutStage = "checkout_created";

export type PilotCheckoutLegalAcceptances = {
  privacyPolicyAccepted?: boolean;
  pilotTermsAccepted?: boolean;
  marketingConsent?: boolean;
};

export type CreatePilotCheckoutInput = {
  offerCode: PilotOfferCode;
  projectType: string;
  name: string;
  email: string;
  phone?: string;
  organization?: string;
  location?: string;
  legalAcceptances?: PilotCheckoutLegalAcceptances;
};

export type CreatePilotCheckoutResult = {
  ok: true;
  checkoutUrl: string;
  sessionId: string;
  offerCode: PilotOfferCode;
  offerLabel: string;
  projectType: string;
  currency: string;
  stage: PilotCheckoutStage;
};

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

  constructor(message: string, options: { status: number; code?: string; payload?: PilotApiErrorPayload | null }) {
    super(message);
    this.name = "PilotApiError";
    this.status = options.status;
    this.code = options.code || "pilot_api_error";
    this.payload = options.payload ?? null;
  }
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizePilotApiError(response: Response, payload: unknown): never {
  const safePayload = payload && typeof payload === "object" ? (payload as PilotApiErrorPayload) : null;

  throw new PilotApiError(
    safePayload?.message || safePayload?.error || "Die Pilot-Anfrage konnte nicht verarbeitet werden.",
    {
      status: response.status,
      code: safePayload?.code || safePayload?.error || "pilot_api_error",
      payload: safePayload,
    },
  );
}

async function postJson<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    normalizePilotApiError(response, payload);
  }

  return payload as TResponse;
}

export async function createPilotCheckout(input: CreatePilotCheckoutInput): Promise<CreatePilotCheckoutResult> {
  return postJson<CreatePilotCheckoutResult>("/api/pilot-checkout", {
    offerCode: input.offerCode,
    projectType: input.projectType,
    name: input.name,
    email: input.email,
    phone: input.phone,
    organization: input.organization,
    location: input.location,
    legalAcceptances: input.legalAcceptances,
  });
}

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
    subtitle: "Die schnellste bezahlte Einordnung für Standorte, Gebäude, Quartiere und erste Betreiberkonstellationen.",
    outcomes: [
      "Erste professionelle Qualifizierung der Konstellation",
      "Einordnung der Ausgangslage für Beteiligte und nächste Schritte",
      "Saubere Grundlage für die Entscheidung über Vertiefung oder Mandat",
    ],
    idealFor: "Eigentümer, Projektträger und kommunale Akteure mit einer ersten konkreten Konstellation.",
    priority: "Fastest path to paid project qualification.",
  },
  et_structuring: {
    title: "Pilot Structuring Package",
    badge: "Empfohlener Standard",
    subtitle: "Die vertiefte Strukturierungsstufe für Projekte, in denen Rollen, Dokumente und Entscheidungsfähigkeit sauber vorbereitet werden müssen.",
    outcomes: [
      "Vertiefte Struktur für Standort, Stakeholder und Projektlogik",
      "Bessere Arbeitsgrundlage für Dokumente, Gespräche und Koordination",
      "Klare nächste operative Schritte statt unverbundener Einzelinformationen",
    ],
    idealFor: "Komplexere Projekte mit mehreren Rollen, Datenquellen oder Abstimmungsbedarf.",
    priority: "Best default offer for serious project leads.",
  },
  et_mandate: {
    title: "Full Pilot Preparation Mandate",
    badge: "Höchste Begleitung",
    subtitle: "Die intensivste Stufe für Vorhaben, die mit höherer Verbindlichkeit, höherem Koordinationsaufwand und klarer Umsetzungsnähe vorbereitet werden sollen.",
    outcomes: [
      "Hochpriorisierte Vorbereitung der Projektgrundlage",
      "Tiefere operative Begleitung der Einordnung und Unterlagenlage",
      "Strukturierte Basis für Folgegespräche, Partnerabstimmung und Umsetzungsschritte",
    ],
    idealFor: "Portfolios, Quartiere und Vorhaben mit echter Umsetzungsabsicht oder institutionellem Druck.",
    priority: "Highest-value path for enterprise-grade project preparation.",
  },
};

export function isPilotOfferCode(value: string): value is PilotOfferCode {
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
