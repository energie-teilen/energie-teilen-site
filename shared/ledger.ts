/**
 * shared/ledger.ts
 *
 * Order ledger: Lead, Project, Stage, Owner, Next Action, Value, Source, held
 * as a state machine rather than a flat table.
 *
 * Two properties define it:
 *
 *   1. Stage transitions are validated. An order cannot move from "paid" to
 *      "delivered" without passing through the intermediate stages, and cannot
 *      leave a terminal state.
 *
 *   2. Next Action is derived, never stored. It is computed from stage, age and
 *      the tier's fulfillment spec, so it cannot go stale.
 *
 * Pure module: no KV, no Stripe, no Express. server/ledger-store.ts persists it.
 */

import { z } from "zod";
import { PilotOfferCodeSchema, type PilotOfferCode } from "./schema.js";
import { PILOT_OFFER_FULFILLMENT } from "./pilot-order.js";

// ============================================================================
// STAGES
// ============================================================================

export const LEDGER_STAGES = [
  /** Checkout session created, payment not yet confirmed. */
  "intake",
  /** Funds captured. Confirmation not yet sent. */
  "paid",
  /** Confirmation + data request sent. Waiting on the customer. */
  "awaiting_data",
  /** Customer data received; the work is being done. */
  "in_progress",
  /** Deliverable sent to the customer. */
  "delivered",
  /** Finished. Terminal unless deliberately reopened. */
  "closed",
  /** Money returned. Terminal. */
  "refunded",
] as const;

export const LedgerStageSchema = z.enum(LEDGER_STAGES);
export type LedgerStage = z.infer<typeof LedgerStageSchema>;

export const STAGE_LABEL_DE: Record<LedgerStage, string> = {
  intake: "Zahlung ausstehend",
  paid: "Bezahlt",
  awaiting_data: "Wartet auf Kundendaten",
  in_progress: "In Bearbeitung",
  delivered: "Geliefert",
  closed: "Abgeschlossen",
  refunded: "Erstattet",
};

/**
 * Allowed transitions. Anything not listed is rejected by advanceStage().
 * `closed` may be reopened to in_progress; `refunded` is terminal.
 */
export const STAGE_TRANSITIONS: Record<LedgerStage, LedgerStage[]> = {
  intake: ["paid", "closed"],
  paid: ["awaiting_data", "in_progress", "refunded", "closed"],
  awaiting_data: ["in_progress", "refunded", "closed"],
  in_progress: ["delivered", "awaiting_data", "refunded", "closed"],
  delivered: ["closed", "refunded"],
  closed: ["in_progress"],
  refunded: [],
};

export function canTransition(from: LedgerStage, to: LedgerStage): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

export const TERMINAL_STAGES: LedgerStage[] = ["refunded"];

/** Stages that represent money received and work owed. */
export const OPEN_STAGES: LedgerStage[] = [
  "paid",
  "awaiting_data",
  "in_progress",
];

// ============================================================================
// RECORDS
// ============================================================================

export const LedgerEventSchema = z.object({
  at: z.string(),
  stage: LedgerStageSchema,
  /** Who or what caused it: "stripe:webhook", "admin:<token-id>", "system". */
  by: z.string(),
  note: z.string().optional(),
});
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

export const OrderLedgerRecordSchema = z.object({
  kind: z.literal("order"),
  /** Human reference, e.g. ET-4F9C21A0. Primary key for humans. */
  reference: z.string().min(1),
  /** Stripe Checkout Session id. Primary key for machines. */
  sessionId: z.string().min(1),
  stage: LedgerStageSchema,
  offerCode: PilotOfferCodeSchema.nullable(),
  offerLabel: z.string(),
  /** Value in cents. The "Value" column. */
  amountTotalCents: z.number().int().nonnegative().nullable(),
  currency: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  organization: z.string().nullable(),
  location: z.string().nullable(),
  projectType: z.string().nullable(),
  /** The "Owner" column. Null until someone claims it. */
  owner: z.string().nullable(),
  source: z.string(),
  /** Which eligibility verdict this order converted from, when known. */
  eligibilityVerdict: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * True when this record could not be written to a durable store, i.e. it
   * exists only in Stripe and an email. Surfaced loudly rather than hidden.
   */
  durable: z.boolean(),
  history: z.array(LedgerEventSchema),
});
export type OrderLedgerRecord = z.infer<typeof OrderLedgerRecordSchema>;

// ============================================================================
// DERIVED: NEXT ACTION
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageInDays(iso: string, now: Date = new Date()): number {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / DAY_MS));
}

export type NextAction = {
  action: string;
  /** true when this has been sitting long enough to need chasing. */
  overdue: boolean;
  ageDays: number;
};

/** How long each open stage may sit before it needs attention. */
export const STAGE_SLA_DAYS: Partial<Record<LedgerStage, number>> = {
  paid: 1,
  awaiting_data: 7,
  in_progress: 14,
};

/**
 * The current next action for an order, derived from stage, age and the tier's
 * fulfillment spec.
 */
export function nextAction(
  record: Pick<OrderLedgerRecord, "stage" | "offerCode" | "updatedAt" | "email">,
  now: Date = new Date(),
): NextAction {
  const ageDays = ageInDays(record.updatedAt, now);
  const sla = STAGE_SLA_DAYS[record.stage];
  const overdue = sla !== undefined && ageDays > sla;

  const deliverable = record.offerCode
    ? PILOT_OFFER_FULFILLMENT[record.offerCode].deliverable
    : "das vereinbarte Ergebnis";

  switch (record.stage) {
    case "intake":
      return { action: "Zahlung ausstehend — keine Aktion erforderlich.", overdue: false, ageDays };
    case "paid":
      return {
        action: record.email
          ? `Bestätigung und Datenanforderung an ${record.email} versenden.`
          : "Bestätigung versenden — keine E-Mail-Adresse hinterlegt, manuell prüfen.",
        overdue,
        ageDays,
      };
    case "awaiting_data":
      return {
        action: overdue
          ? `Seit ${ageDays} Tagen keine Projektdaten — nachfassen${record.email ? ` bei ${record.email}` : ""}.`
          : "Auf Projektdaten des Kunden warten.",
        overdue,
        ageDays,
      };
    case "in_progress":
      return { action: `Erstellen: ${deliverable}`, overdue, ageDays };
    case "delivered":
      return {
        action: "Rückmeldung einholen und nächste Pilotstufe anbieten.",
        overdue: false,
        ageDays,
      };
    case "closed":
      return { action: "Keine Aktion.", overdue: false, ageDays };
    case "refunded":
      return { action: "Keine Aktion — erstattet.", overdue: false, ageDays };
  }
}

// ============================================================================
// TRANSITIONS
// ============================================================================

export type AdvanceResult =
  | { ok: true; record: OrderLedgerRecord }
  | { ok: false; reason: "invalid_transition"; allowed: LedgerStage[] };

/**
 * Move an order to a new stage, or refuse. Appends to the record's history so
 * each transition carries actor and timestamp.
 */
export function advanceStage(
  record: OrderLedgerRecord,
  to: LedgerStage,
  by: string,
  options?: { note?: string; now?: Date },
): AdvanceResult {
  if (!canTransition(record.stage, to)) {
    return { ok: false, reason: "invalid_transition", allowed: STAGE_TRANSITIONS[record.stage] };
  }
  const at = (options?.now ?? new Date()).toISOString();
  return {
    ok: true,
    record: {
      ...record,
      stage: to,
      updatedAt: at,
      history: [...record.history, { at, stage: to, by, note: options?.note }],
    },
  };
}

// ============================================================================
// SUMMARY — what the operator sees first
// ============================================================================

export type LedgerSummary = {
  total: number;
  open: number;
  overdue: number;
  byStage: Record<LedgerStage, number>;
  /** Paid orders grouped by the verdict they converted from. */
  byVerdict: Record<string, number>;
  /** Sum of open orders in cents. Money owed work. */
  openValueCents: number;
  /** Orders that exist only in Stripe and an inbox. */
  nonDurable: number;
};

export function summarise(
  records: OrderLedgerRecord[],
  now: Date = new Date(),
): LedgerSummary {
  const byStage = Object.fromEntries(
    LEDGER_STAGES.map((s) => [s, 0]),
  ) as Record<LedgerStage, number>;

  const byVerdict: Record<string, number> = {};
  let open = 0;
  let overdue = 0;
  let openValueCents = 0;
  let nonDurable = 0;

  for (const r of records) {
    byStage[r.stage] += 1;
    const v = r.eligibilityVerdict ?? "UNKNOWN";
    byVerdict[v] = (byVerdict[v] ?? 0) + 1;
    if (!r.durable) nonDurable += 1;
    if (OPEN_STAGES.includes(r.stage)) {
      open += 1;
      openValueCents += r.amountTotalCents ?? 0;
      if (nextAction(r, now).overdue) overdue += 1;
    }
  }

  return { total: records.length, open, overdue, byStage, byVerdict, openValueCents, nonDurable };
}

/** Worklist order: overdue first, then oldest. Closed and refunded sink. */
export function sortForWorklist(
  records: OrderLedgerRecord[],
  now: Date = new Date(),
): OrderLedgerRecord[] {
  const rank = (r: OrderLedgerRecord): number => {
    if (!OPEN_STAGES.includes(r.stage)) return 2;
    return nextAction(r, now).overdue ? 0 : 1;
  };
  return [...records].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
  );
}

export function offerCodeOrNull(value: unknown): PilotOfferCode | null {
  const parsed = PilotOfferCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
