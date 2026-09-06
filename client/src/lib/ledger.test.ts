import { describe, it, expect } from "vitest";
import {
  LEDGER_STAGES,
  OPEN_STAGES,
  OrderLedgerRecordSchema,
  STAGE_TRANSITIONS,
  advanceStage,
  ageInDays,
  canTransition,
  nextAction,
  sortForWorklist,
  summarise,
  type LedgerStage,
  type OrderLedgerRecord,
} from "../../../shared/ledger";
import { PILOT_OFFER_FULFILLMENT } from "../../../shared/pilot-order";

const NOW = new Date("2026-09-06T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function record(over: Partial<OrderLedgerRecord> = {}): OrderLedgerRecord {
  return {
    kind: "order",
    reference: "ET-A1B2C3D4",
    sessionId: "cs_test_a1b2c3d4e5f6g7h8",
    stage: "paid",
    offerCode: "et_structuring",
    offerLabel: "Pilot Structuring Package",
    amountTotalCents: 149000,
    currency: "EUR",
    email: "kunde@example.de",
    name: "Vorname Nachname",
    organization: "Wohnbau GmbH",
    location: "Frankfurt am Main",
    projectType: "quartier",
    owner: null,
    source: "stripe:checkout",
    eligibilityVerdict: "LIKELY_ELIGIBLE",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    durable: true,
    history: [{ at: daysAgo(1), stage: "intake", by: "stripe:webhook" }],
    ...over,
  };
}

describe("ledger record shape", () => {
  it("round-trips through the schema", () => {
    expect(OrderLedgerRecordSchema.safeParse(record()).success).toBe(true);
  });

  it("carries the seven columns the brief asks for", () => {
    const r = record();
    // Lead, Project, Stage, Owner, Next Action, Value, Source
    expect(r.email).toBeTruthy();
    expect(r.location).toBeTruthy();
    expect(r.stage).toBeTruthy();
    expect(r).toHaveProperty("owner");
    expect(nextAction(r, NOW).action).toBeTruthy();
    expect(r.amountTotalCents).toBeGreaterThan(0);
    expect(r.source).toBe("stripe:checkout");
  });
});

describe("stage machine", () => {
  it("defines transitions for every stage", () => {
    for (const s of LEDGER_STAGES) {
      expect(STAGE_TRANSITIONS[s], `${s} has no transition list`).toBeDefined();
    }
  });

  it("refuses to skip the work", () => {
    // paid -> delivered would mean claiming delivery of something never done.
    expect(canTransition("paid", "delivered")).toBe(false);
    const res = advanceStage(record({ stage: "paid" }), "delivered", "admin:test");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.allowed).toContain("awaiting_data");
  });

  it("allows the real path end to end", () => {
    const path: LedgerStage[] = ["awaiting_data", "in_progress", "delivered", "closed"];
    let r = record({ stage: "paid" });
    for (const to of path) {
      const res = advanceStage(r, to, "admin:test", { now: NOW });
      expect(res.ok, `paid→…→${to}`).toBe(true);
      if (res.ok) r = res.record;
    }
    expect(r.stage).toBe("closed");
  });

  it("treats refunded as genuinely terminal", () => {
    expect(STAGE_TRANSITIONS.refunded).toEqual([]);
    expect(advanceStage(record({ stage: "refunded" }), "in_progress", "admin:test").ok).toBe(false);
  });

  it("lets closed work be reopened, because real work reopens", () => {
    expect(canTransition("closed", "in_progress")).toBe(true);
  });

  it("appends an audit entry on every accepted move", () => {
    const res = advanceStage(record({ stage: "paid" }), "awaiting_data", "admin:9f2c", {
      note: "Bestätigung versendet",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const last = res.record.history[res.record.history.length - 1];
      expect(last).toEqual({
        at: NOW.toISOString(),
        stage: "awaiting_data",
        by: "admin:9f2c",
        note: "Bestätigung versendet",
      });
      expect(res.record.updatedAt).toBe(NOW.toISOString());
    }
  });

  it("does not mutate the input record", () => {
    const before = record({ stage: "paid" });
    advanceStage(before, "awaiting_data", "admin:test");
    expect(before.stage).toBe("paid");
    expect(before.history).toHaveLength(1);
  });
});

describe("next action is derived, never stored", () => {
  it("tells you to chase a customer who has gone quiet", () => {
    const r = record({ stage: "awaiting_data", updatedAt: daysAgo(9) });
    const na = nextAction(r, NOW);
    expect(na.overdue).toBe(true);
    expect(na.ageDays).toBe(9);
    expect(na.action).toContain("nachfassen");
    expect(na.action).toContain("kunde@example.de");
  });

  it("stays quiet while the customer is still within the window", () => {
    const na = nextAction(record({ stage: "awaiting_data", updatedAt: daysAgo(3) }), NOW);
    expect(na.overdue).toBe(false);
    expect(na.action).not.toContain("nachfassen");
  });

  it("names the actual deliverable when work is in progress", () => {
    const na = nextAction(record({ stage: "in_progress" }), NOW);
    expect(na.action).toContain(PILOT_OFFER_FULFILLMENT.et_structuring.deliverable);
  });

  it("flags a paid order with no email as needing manual attention", () => {
    const na = nextAction(record({ stage: "paid", email: null }), NOW);
    expect(na.action).toContain("manuell");
  });

  it("asks for nothing once the order is closed or refunded", () => {
    expect(nextAction(record({ stage: "closed" }), NOW).overdue).toBe(false);
    expect(nextAction(record({ stage: "refunded" }), NOW).action).toContain("erstattet");
  });
});

describe("summary — what is open and what is it worth", () => {
  const records = [
    record({ reference: "ET-00000001", stage: "paid", updatedAt: daysAgo(0), amountTotalCents: 49000 }),
    record({ reference: "ET-00000002", stage: "awaiting_data", updatedAt: daysAgo(12), amountTotalCents: 149000 }),
    record({ reference: "ET-00000003", stage: "in_progress", updatedAt: daysAgo(2), amountTotalCents: 499000 }),
    record({ reference: "ET-00000004", stage: "delivered", updatedAt: daysAgo(30), amountTotalCents: 149000 }),
    record({ reference: "ET-00000005", stage: "refunded", updatedAt: daysAgo(40), amountTotalCents: 49000, durable: false }),
  ];

  it("counts only unfinished work as open", () => {
    const s = summarise(records, NOW);
    expect(s.total).toBe(5);
    expect(s.open).toBe(3);
    expect(OPEN_STAGES).toEqual(["paid", "awaiting_data", "in_progress"]);
  });

  it("sums the value of work that is owed", () => {
    expect(summarise(records, NOW).openValueCents).toBe(49000 + 149000 + 499000);
  });

  it("counts what has gone overdue", () => {
    expect(summarise(records, NOW).overdue).toBe(1);
  });

  it("surfaces orders that were never durably stored", () => {
    expect(summarise(records, NOW).nonDurable).toBe(1);
  });

  // The join that turns the qualification gate from a feature into a decision:
  // which verdicts the people who actually paid came from.
  it("groups orders by the eligibility verdict they converted from", () => {
    const mixed = [
      record({ reference: "ET-V1", eligibilityVerdict: "ELIGIBLE" }),
      record({ reference: "ET-V2", eligibilityVerdict: "ELIGIBLE" }),
      record({ reference: "ET-V3", eligibilityVerdict: "INSUFFICIENT_DATA" }),
      record({ reference: "ET-V4", eligibilityVerdict: null }),
    ];
    expect(summarise(mixed, NOW).byVerdict).toEqual({
      ELIGIBLE: 2,
      INSUFFICIENT_DATA: 1,
      UNKNOWN: 1,
    });
  });
});

describe("worklist ordering", () => {
  it("puts overdue work first, then the oldest, and sinks finished orders", () => {
    const records = [
      record({ reference: "ET-CLOSED001", stage: "closed", updatedAt: daysAgo(1) }),
      record({ reference: "ET-FRESH0001", stage: "in_progress", updatedAt: daysAgo(1) }),
      record({ reference: "ET-OVERDUE01", stage: "awaiting_data", updatedAt: daysAgo(20) }),
      record({ reference: "ET-OLDER0001", stage: "in_progress", updatedAt: daysAgo(5) }),
    ];
    expect(sortForWorklist(records, NOW).map((r) => r.reference)).toEqual([
      "ET-OVERDUE01",
      "ET-OLDER0001",
      "ET-FRESH0001",
      "ET-CLOSED001",
    ]);
  });
});

describe("ageInDays", () => {
  it("handles a malformed timestamp without throwing", () => {
    expect(ageInDays("not-a-date", NOW)).toBe(0);
  });

  it("never goes negative for a future timestamp", () => {
    expect(ageInDays(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBe(0);
  });
});
