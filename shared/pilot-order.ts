/**
 * shared/pilot-order.ts
 *
 * The FULFILLMENT half of the paid funnel.
 *
 * Until now the funnel ended at `checkout_created`. Stripe redirected the
 * buyer to `/?paid=1&session_id=...` and nothing on either side of the wire
 * read it: no confirmation, no statement of what was bought, no next step.
 * This file closes that gap.
 *
 * Two responsibilities, both deterministic and unit-tested:
 *
 *   1. PILOT_OFFER_FULFILLMENT — what each paid tier actually delivers and
 *      which project data the customer must supply for work to start. This is
 *      operational truth, not marketing copy, so it lives next to the schema
 *      rather than in the React tree.
 *
 *   2. toPilotOrder() — a pure mapper from a Stripe Checkout Session to the
 *      safe public projection the browser is allowed to see. No Stripe SDK
 *      import: this module is bundled into the client, so it only knows a
 *      structural shape. No secrets, no line items, no payment intents.
 *
 * DELIBERATELY ABSENT: any delivery deadline or turnaround guarantee. The AGB
 * (§ 2) does not state one, so inventing one here would be selling a
 * contractual term that does not exist. If the operator wants to communicate a
 * response window, they set ET_PILOT_RESPONSE_WINDOW and it is echoed verbatim.
 */

import {
  PILOT_OFFER_SERVER_CONFIG,
  isPilotOfferCode,
  type PilotOfferCode,
  type PilotOrder,
  type PilotOrderStatus,
  type ProjectType,
} from "./schema.js";

// ============================================================================
// FULFILLMENT SPEC — what the customer bought, and what we need from them
// ============================================================================

export type PilotFulfillmentSpec = {
  /** What Energie Teilen produces for this tier. Concrete artefact, not a mood. */
  deliverable: string;
  /**
   * The project data the customer must supply before work can begin.
   * Rendered as a checklist on the confirmation screen and repeated in the
   * confirmation email, so "what happens next" is an action, not a wait.
   */
  requiredData: string[];
};

export const PILOT_OFFER_FULFILLMENT: Record<PilotOfferCode, PilotFulfillmentSpec> = {
  et_eligibility: {
    deliverable:
      "Schriftliche Erst-Einordnung Ihrer Konstellation als PDF: Ausgangslage, wirtschaftliche Einordnung, offene Punkte und empfohlener nächster Schritt.",
    requiredData: [
      "Standort: Adresse oder Flurstück",
      "Anzahl und Art der Einheiten (Wohnen / Gewerbe)",
      "Erzeugungsanlage: kWp, Status (Bestand / geplant), geplantes Inbetriebnahmejahr",
      "Eigentümer- und Betreiberkonstellation (wer besitzt, wer betreibt, wer liefert)",
      "Jahresverbrauch oder Lastgang, sofern vorhanden",
    ],
  },
  et_structuring: {
    deliverable:
      "Strukturierungspaket als PDF: Rollen- und Vertragsmodell, Bewertung der Datenlage, benannte offene Punkte und ein priorisierter Maßnahmenplan.",
    requiredData: [
      "Standort: Adresse oder Flurstück",
      "Anzahl und Art der Einheiten (Wohnen / Gewerbe)",
      "Erzeugungsanlage: kWp, Status (Bestand / geplant), geplantes Inbetriebnahmejahr",
      "Eigentümer- und Betreiberkonstellation (wer besitzt, wer betreibt, wer liefert)",
      "Jahresverbrauch oder Lastgang, sofern vorhanden",
      "Zähler- und Messkonzept: Zählerstruktur, aktueller Messstellenbetreiber",
      "Bestehende Liefer-, Miet- oder Pachtverträge, die die Konstellation berühren",
      "Entscheidungsträger und angestrebter Zeitrahmen",
    ],
  },
  et_mandate: {
    deliverable:
      "Vollständige Pilotvorbereitung: Strukturierungspaket, aufbereitete Unterlagenlage und begleitete Abstimmung bis zur Entscheidungsreife.",
    requiredData: [
      "Standort: Adresse oder Flurstück",
      "Anzahl und Art der Einheiten (Wohnen / Gewerbe)",
      "Erzeugungsanlage: kWp, Status (Bestand / geplant), geplantes Inbetriebnahmejahr",
      "Eigentümer- und Betreiberkonstellation (wer besitzt, wer betreibt, wer liefert)",
      "Jahresverbrauch oder Lastgang, sofern vorhanden",
      "Zähler- und Messkonzept: Zählerstruktur, aktueller Messstellenbetreiber",
      "Bestehende Liefer-, Miet- oder Pachtverträge, die die Konstellation berühren",
      "Entscheidungsträger und angestrebter Zeitrahmen",
      "Beteiligte Dritte (Verwaltung, Netzbetreiber, Installateur, Finanzierung)",
      "Vorliegende Gutachten, Angebote oder Vorplanungen",
    ],
  },
};

// ============================================================================
// STRIPE SESSION — structural shape only (no SDK import; this file ships to
// the browser via the shared bundle)
// ============================================================================

export type StripeCheckoutSessionLike = {
  id: string;
  status?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  created?: number | null;
  metadata?: Record<string, string> | null;
};

/**
 * Derive order status from the two independent Stripe fields.
 *
 * This matters because checkout accepts `sepa_debit`, where the session
 * completes but `payment_status` stays "unpaid" until the debit settles —
 * days later. Collapsing that into a boolean would either tell a paying SEPA
 * customer they failed, or tell an unpaid one they succeeded.
 */
export function derivePilotOrderStatus(
  session: Pick<StripeCheckoutSessionLike, "status" | "payment_status">,
): PilotOrderStatus {
  if (session.status === "expired") return "expired";
  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
    return "paid";
  }
  if (session.status === "complete") return "processing";
  return "unpaid";
}

/**
 * Short, human-quotable order reference. Deterministic from the session id so
 * the customer, the confirmation email and the operator inbox all name the
 * same string without a database round-trip.
 */
export function orderReference(sessionId: string): string {
  const tail = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return `ET-${tail.padStart(8, "0")}`;
}

function asOfferCode(value: string | undefined): PilotOfferCode | null {
  return value !== undefined && isPilotOfferCode(value) ? value : null;
}

const PROJECT_TYPES: ReadonlySet<string> = new Set<ProjectType>([
  "gebaeude",
  "quartier",
  "portfolio",
  "kommunal",
  "infrastruktur",
]);

function asProjectType(value: string | undefined): ProjectType | null {
  return value !== undefined && PROJECT_TYPES.has(value) ? (value as ProjectType) : null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Map a Stripe Checkout Session to the public order projection.
 *
 * Pure. Everything it returns is either derived from the session or from the
 * fulfillment spec above — nothing is invented, nothing sensitive is exposed.
 */
export function toPilotOrder(
  session: StripeCheckoutSessionLike,
  options?: { responseWindow?: string | null },
): PilotOrder {
  const md = session.metadata ?? {};
  const offerCode = asOfferCode(md.offerCode);
  const fulfillment = offerCode ? PILOT_OFFER_FULFILLMENT[offerCode] : null;
  const serverConfig = offerCode ? PILOT_OFFER_SERVER_CONFIG[offerCode] : null;

  return {
    ok: true,
    sessionId: session.id,
    reference: orderReference(session.id),
    status: derivePilotOrderStatus(session),
    offerCode,
    offerLabel: nonEmpty(md.offerLabel) ?? serverConfig?.label ?? "Pilotaufnahme",
    amountTotalCents:
      typeof session.amount_total === "number" ? session.amount_total : null,
    currency: (session.currency ?? "eur").toUpperCase(),
    email: nonEmpty(md.email) ?? nonEmpty(session.customer_details?.email) ?? nonEmpty(session.customer_email),
    organization: nonEmpty(md.organization),
    location: nonEmpty(md.location),
    projectType: asProjectType(md.projectType),
    createdAt:
      typeof session.created === "number"
        ? new Date(session.created * 1000).toISOString()
        : null,
    deliverable: fulfillment?.deliverable ?? "",
    requiredData: fulfillment?.requiredData ?? [],
    responseWindow: nonEmpty(options?.responseWindow),
  };
}
