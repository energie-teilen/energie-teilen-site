import { describe, it, expect } from "vitest";
import {
  PILOT_OFFER_FULFILLMENT,
  derivePilotOrderStatus,
  orderReference,
  toPilotOrder,
  type StripeCheckoutSessionLike,
} from "../../../shared/pilot-order";
import { PilotOrderSchema } from "../../../shared/schema";

/**
 * These tests guard the fulfillment leg of the paid funnel: the mapping from a
 * Stripe Checkout Session to what a paying customer is actually shown.
 *
 * They exist because the failure mode is invisible in production — a broken
 * mapper does not throw, it just renders a confirmation that says nothing, to
 * someone who has already been charged.
 */

const paidSession: StripeCheckoutSessionLike = {
  id: "cs_test_a1b2c3d4e5f6g7h8",
  status: "complete",
  payment_status: "paid",
  amount_total: 149000,
  currency: "eur",
  customer_email: "stripe@example.de",
  created: 1_780_000_000,
  metadata: {
    offerCode: "et_structuring",
    offerLabel: "Pilot Structuring Package",
    projectType: "quartier",
    name: "Vorname Nachname",
    email: "kunde@example.de",
    organization: "Wohnbau GmbH",
    location: "Frankfurt am Main",
    phone: "+49 69 000000",
  },
};

describe("derivePilotOrderStatus", () => {
  it("treats a captured card payment as paid", () => {
    expect(derivePilotOrderStatus({ status: "complete", payment_status: "paid" })).toBe("paid");
  });

  // The one that actually matters: checkout enables sepa_debit, where the
  // session completes days before the money settles. Collapsing this into a
  // boolean would tell a real paying customer their payment failed.
  it("treats a completed-but-unsettled SEPA debit as processing, not failed", () => {
    expect(derivePilotOrderStatus({ status: "complete", payment_status: "unpaid" })).toBe(
      "processing",
    );
  });

  it("reports an abandoned checkout as unpaid", () => {
    expect(derivePilotOrderStatus({ status: "open", payment_status: "unpaid" })).toBe("unpaid");
  });

  it("reports an expired session as expired even if payment_status lags", () => {
    expect(derivePilotOrderStatus({ status: "expired", payment_status: "unpaid" })).toBe(
      "expired",
    );
  });

  it("accepts zero-amount / no_payment_required sessions as paid", () => {
    expect(
      derivePilotOrderStatus({ status: "complete", payment_status: "no_payment_required" }),
    ).toBe("paid");
  });
});

describe("orderReference", () => {
  it("is deterministic and human-quotable", () => {
    expect(orderReference("cs_test_a1b2c3d4e5f6g7h8")).toBe("ET-E5F6G7H8");
    expect(orderReference("cs_test_a1b2c3d4e5f6g7h8")).toBe(
      orderReference("cs_test_a1b2c3d4e5f6g7h8"),
    );
  });

  it("stays well-formed for unexpectedly short ids", () => {
    expect(orderReference("cs_x")).toMatch(/^ET-[0-9A-Z]{8}$/);
  });

  it("differs between sessions", () => {
    expect(orderReference("cs_test_aaaaaaaaaaaa")).not.toBe(
      orderReference("cs_test_bbbbbbbbbbbb"),
    );
  });
});

describe("toPilotOrder", () => {
  it("produces a payload that satisfies the wire schema", () => {
    const parsed = PilotOrderSchema.safeParse(toPilotOrder(paidSession));
    expect(parsed.success).toBe(true);
  });

  it("carries the concrete next step, so the UI never has to say 'contact us'", () => {
    const order = toPilotOrder(paidSession);
    expect(order.deliverable).toBe(PILOT_OFFER_FULFILLMENT.et_structuring.deliverable);
    expect(order.requiredData).toEqual(PILOT_OFFER_FULFILLMENT.et_structuring.requiredData);
    expect(order.requiredData.length).toBeGreaterThan(0);
  });

  it("prefers the email the customer typed over Stripe's own field", () => {
    expect(toPilotOrder(paidSession).email).toBe("kunde@example.de");
  });

  it("falls back to Stripe's customer email when metadata is absent", () => {
    const order = toPilotOrder({ ...paidSession, metadata: {} });
    expect(order.email).toBe("stripe@example.de");
  });

  // No turnaround is stated in the AGB, so the product must not invent one.
  it("omits a response window unless the operator explicitly configures it", () => {
    expect(toPilotOrder(paidSession).responseWindow).toBeNull();
    expect(toPilotOrder(paidSession, { responseWindow: "  " }).responseWindow).toBeNull();
    expect(toPilotOrder(paidSession, { responseWindow: "5 Werktage" }).responseWindow).toBe(
      "5 Werktage",
    );
  });

  it("never leaks unrecognised metadata as a valid offer or project type", () => {
    const order = toPilotOrder({
      ...paidSession,
      metadata: { offerCode: "et_free_lunch", projectType: "raumstation" },
    });
    expect(order.offerCode).toBeNull();
    expect(order.projectType).toBeNull();
    expect(order.requiredData).toEqual([]);
    expect(PilotOrderSchema.safeParse(order).success).toBe(true);
  });

  it("degrades safely on a session with almost nothing on it", () => {
    const order = toPilotOrder({ id: "cs_test_minimal_00000000" });
    expect(PilotOrderSchema.safeParse(order).success).toBe(true);
    expect(order.status).toBe("unpaid");
    expect(order.amountTotalCents).toBeNull();
    expect(order.currency).toBe("EUR");
    expect(order.offerLabel).toBe("Pilotaufnahme");
  });

  it("normalises empty-string metadata to null rather than blank UI rows", () => {
    const order = toPilotOrder({
      ...paidSession,
      metadata: { ...paidSession.metadata, organization: "", location: "   " },
    });
    expect(order.organization).toBeNull();
    expect(order.location).toBeNull();
  });

  it("converts the Stripe unix timestamp to ISO", () => {
    expect(toPilotOrder(paidSession).createdAt).toBe(
      new Date(1_780_000_000 * 1000).toISOString(),
    );
  });
});

describe("PILOT_OFFER_FULFILLMENT", () => {
  it("defines a deliverable and an intake checklist for every paid tier", () => {
    for (const [code, spec] of Object.entries(PILOT_OFFER_FULFILLMENT)) {
      expect(spec.deliverable.length, `${code} deliverable`).toBeGreaterThan(20);
      expect(spec.requiredData.length, `${code} requiredData`).toBeGreaterThan(0);
    }
  });

  it("asks for progressively more as the tier deepens", () => {
    expect(PILOT_OFFER_FULFILLMENT.et_structuring.requiredData.length).toBeGreaterThan(
      PILOT_OFFER_FULFILLMENT.et_eligibility.requiredData.length,
    );
    expect(PILOT_OFFER_FULFILLMENT.et_mandate.requiredData.length).toBeGreaterThan(
      PILOT_OFFER_FULFILLMENT.et_structuring.requiredData.length,
    );
  });
});
