import { describe, it, expect } from "vitest";
import {
  BILLING_DISCLAIMER_DE,
  BillingError,
  BillingInputSchema,
  PRORATION_CONVENTION_DE,
  VAT_STANDARD_RATE,
  billPeriod,
  daysInPeriod,
  formatEur,
  reconcile,
  roundCents,
  type BillingInput,
  type Tariff,
} from "../../../shared/billing";
import { allocate, illustrativeDayProfile, illustrativeShares } from "../../../shared/allocation";

const YEAR = { from: "2026-01-01", to: "2027-01-01" };

const TARIFF: Tariff = {
  mieterstromCtPerKwh: 28,
  reststromCtPerKwh: 34,
  grundpreisEurPerYear: 120,
};

function build(over: Partial<BillingInput> = {}): BillingInput {
  return {
    period: YEAR,
    tariff: TARIFF,
    participants: [
      { id: "we-1", allocatedKwh: 1200, gridDrawKwh: 1800 },
      { id: "we-2", allocatedKwh: 900, gridDrawKwh: 2100 },
    ],
    ...over,
  };
}

describe("money handling", () => {
  it("rounds half away from zero, so a credit and a charge round alike", () => {
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(-1.5)).toBe(-2);
    expect(roundCents(2.4)).toBe(2);
  });

  it("formats cents as German euro amounts", () => {
    expect(formatEur(123456)).toBe("1.234,56 €");
    expect(formatEur(-500)).toBe("-5,00 €");
    expect(formatEur(0)).toBe("0,00 €");
  });
});

describe("period", () => {
  it("counts days from the start date up to but not including the end", () => {
    expect(daysInPeriod({ from: "2026-01-01", to: "2027-01-01" })).toBe(365);
    expect(daysInPeriod({ from: "2024-01-01", to: "2025-01-01" })).toBe(366);
    expect(daysInPeriod({ from: "2026-03-01", to: "2026-04-01" })).toBe(31);
  });

  it("rejects a reversed period at the schema boundary", () => {
    expect(
      BillingInputSchema.safeParse(build({ period: { from: "2027-01-01", to: "2026-01-01" } })).success,
    ).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(BillingInputSchema.safeParse(build({ period: { from: "01.01.2026", to: "2027-01-01" } })).success).toBe(
      false,
    );
  });
});

describe("statement arithmetic", () => {
  it("prices each energy stream at its own working price", () => {
    const r = billPeriod(build());
    const s = r.statements[0];
    const byCode = Object.fromEntries(s.lines.map((l) => [l.code, l]));
    expect(byCode.mieterstrom.netCents).toBe(1200 * 28);
    expect(byCode.reststrom.netCents).toBe(1800 * 34);
  });

  it("prorates the standing charge across the days of the period", () => {
    const full = billPeriod(build());
    expect(full.statements[0].lines.find((l) => l.code === "grundpreis")!.netCents).toBe(12000);

    const half = billPeriod(build({ period: { from: "2026-01-01", to: "2026-07-01" } }));
    // 181 days of 365 at 120,00 EUR/year.
    expect(half.statements[0].lines.find((l) => l.code === "grundpreis")!.netCents).toBe(
      Math.round((12000 * 181) / 365),
    );
  });

  it("states the proration convention rather than applying it silently", () => {
    expect(billPeriod(build()).conventions).toContain(PRORATION_CONVENTION_DE);
  });

  it("makes the net total the sum of its own lines", () => {
    const s = billPeriod(build()).statements[0];
    expect(s.netCents).toBe(s.lines.reduce((acc, l) => acc + l.netCents, 0));
  });

  it("adds VAT at the standard rate by default", () => {
    const r = billPeriod(build());
    expect(r.vatRate).toBe(VAT_STANDARD_RATE);
    const s = r.statements[0];
    expect(s.vatCents).toBe(Math.round(s.netCents * VAT_STANDARD_RATE));
    expect(s.grossCents).toBe(s.netCents + s.vatCents);
  });

  it("honours an explicit VAT rate", () => {
    const r = billPeriod(build({ vatRate: 0.07 }));
    expect(r.statements[0].vatCents).toBe(Math.round(r.statements[0].netCents * 0.07));
  });

  it("nets instalments off against the gross amount", () => {
    const r = billPeriod(
      build({
        participants: [{ id: "we-1", allocatedKwh: 1200, gridDrawKwh: 1800, prepaidEur: 1000 }],
      }),
    );
    const s = r.statements[0];
    expect(s.prepaidCents).toBe(100_000);
    expect(s.balanceCents).toBe(s.grossCents - 100_000);
  });

  it("reports a credit as a negative balance rather than as zero", () => {
    const r = billPeriod(
      build({ participants: [{ id: "we-1", allocatedKwh: 100, gridDrawKwh: 0, prepaidEur: 900 }] }),
    );
    expect(r.statements[0].balanceCents).toBeLessThan(0);
    expect(r.warnings.map((w) => w.code)).toContain("refunds_due");
  });

  it("omits a line rather than printing a zero one", () => {
    const r = billPeriod(build({ participants: [{ id: "we-1", allocatedKwh: 0, gridDrawKwh: 500 }] }));
    expect(r.statements[0].lines.map((l) => l.code)).not.toContain("mieterstrom");
    expect(r.warnings.map((w) => w.code)).toContain("participants_without_allocation");
  });

  it("reports the shared share of each participant's consumption", () => {
    const s = billPeriod(build()).statements[0];
    expect(s.consumptionKwh).toBe(3000);
    expect(s.sharedShare).toBeCloseTo(1200 / 3000, 12);
  });

  it("reports no shared share for a participant who consumed nothing", () => {
    const r = billPeriod(build({ participants: [{ id: "we-1", allocatedKwh: 0, gridDrawKwh: 0 }] }));
    expect(r.statements[0].sharedShare).toBeNull();
  });
});

describe("reconciliation", () => {
  it("holds for the base case", () => {
    expect(reconcile(billPeriod(build())).ok).toBe(true);
  });

  it("holds across many participants with awkward quantities", () => {
    const participants = Array.from({ length: 137 }, (_, i) => ({
      id: `we-${i}`,
      allocatedKwh: 137.137 + i * 3.3333,
      gridDrawKwh: 991.777 - i * 1.111,
      prepaidEur: i % 4 === 0 ? 333.33 : undefined,
    }));
    const r = billPeriod(build({ participants }));
    const check = reconcile(r);
    expect(check.failures).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it("holds for a part-year period", () => {
    expect(reconcile(billPeriod(build({ period: { from: "2026-04-15", to: "2026-09-30" } }))).ok).toBe(
      true,
    );
  });

  it("makes the period total the sum of the statements, with no residual", () => {
    const r = billPeriod(build());
    expect(r.totals.grossCents).toBe(r.statements.reduce((s, x) => s + x.grossCents, 0));
    expect(r.totals.balanceCents).toBe(r.totals.grossCents - r.totals.prepaidCents);
  });
});

describe("comparison against basic supply", () => {
  it("reports the comparison as unknown without the reference tariff", () => {
    const r = billPeriod(build());
    expect(r.statements[0].savingVsGrundversorgungCents).toBeNull();
    expect(r.totals.savingVsGrundversorgungCents).toBeNull();
    expect(r.priceCap.status).toBe("unknown");
    expect(r.warnings.map((w) => w.code)).toContain("price_cap_unchecked");
    expect(r.missingData).toContain("Örtlicher Grundversorgungstarif");
  });

  it("computes the saving when the reference tariff is supplied", () => {
    const r = billPeriod(
      build({ tariff: { ...TARIFF, grundversorgungCtPerKwh: 36 } }),
    );
    const s = r.statements[0];
    expect(s.savingVsGrundversorgungCents).not.toBeNull();
    // Shared energy at 28 instead of 36 is the whole of the difference here.
    expect(s.savingVsGrundversorgungCents!).toBeGreaterThan(0);
    expect(r.totals.savingVsGrundversorgungCents).toBe(
      r.statements.reduce((acc, x) => acc + (x.savingVsGrundversorgungCents ?? 0), 0),
    );
  });

  it("reports a negative saving rather than hiding it", () => {
    const r = billPeriod(
      build({
        tariff: { ...TARIFF, mieterstromCtPerKwh: 40, grundversorgungCtPerKwh: 30 },
      }),
    );
    expect(r.statements[0].savingVsGrundversorgungCents!).toBeLessThan(0);
  });

  it("flags a working price above the comparison value", () => {
    const r = billPeriod(
      build({ tariff: { ...TARIFF, mieterstromCtPerKwh: 34, grundversorgungCtPerKwh: 36 } }),
    );
    expect(r.priceCap.status).toBe("over_cap");
    expect(r.warnings.map((w) => w.code)).toContain("price_over_cap");
  });

  it("uses the basic-supply standing charge when one is given", () => {
    const cheap = billPeriod(
      build({
        tariff: { ...TARIFF, grundversorgungCtPerKwh: 36, grundversorgungGrundpreisEurPerYear: 60 },
      }),
    );
    const same = billPeriod(build({ tariff: { ...TARIFF, grundversorgungCtPerKwh: 36 } }));
    expect(cheap.statements[0].savingVsGrundversorgungCents!).toBeLessThan(
      same.statements[0].savingVsGrundversorgungCents!,
    );
  });
});

describe("data completeness and discipline", () => {
  it("names the fields a statement would normally carry but does not have", () => {
    const r = billPeriod(build());
    expect(r.missingData).toContain("Zählernummer je Teilnehmer");
    expect(r.missingData).toContain("Geleistete Abschlagszahlungen");
  });

  it("stops naming a field once it is supplied for anyone", () => {
    const r = billPeriod(
      build({
        participants: [
          { id: "we-1", allocatedKwh: 100, gridDrawKwh: 100, meterNumber: "1ESY0000" },
          { id: "we-2", allocatedKwh: 100, gridDrawKwh: 100 },
        ],
      }),
    );
    expect(r.missingData).not.toContain("Zählernummer je Teilnehmer");
    expect(r.statements[0].meterNumber).toBe("1ESY0000");
    expect(r.statements[1].meterNumber).toBeNull();
  });

  it("flags the VAT rate as unverified rather than presenting it as established", () => {
    expect(billPeriod(build()).warnings.map((w) => w.code)).toContain("vat_rate_unverified");
  });

  it("carries the disclaimer, and it claims no legal effect", () => {
    const r = billPeriod(build());
    expect(r.disclaimer).toBe(BILLING_DISCLAIMER_DE);
    expect(BILLING_DISCLAIMER_DE).toMatch(/ersetzt weder/);
  });

  it("rejects duplicate participants", () => {
    expect(() =>
      billPeriod(
        build({
          participants: [
            { id: "we-1", allocatedKwh: 1, gridDrawKwh: 1 },
            { id: "we-1", allocatedKwh: 1, gridDrawKwh: 1 },
          ],
        }),
      ),
    ).toThrow(BillingError);
  });

  it("rejects negative quantities at the schema boundary", () => {
    expect(
      BillingInputSchema.safeParse(
        build({ participants: [{ id: "a", allocatedKwh: -1, gridDrawKwh: 0 }] }),
      ).success,
    ).toBe(false);
  });

  it("is deterministic", () => {
    expect(billPeriod(build())).toEqual(billPeriod(build()));
  });
});

// The three engines have to compose: what the allocation says a participant
// took is exactly what the statement charges them for.
describe("composition with the allocation engine", () => {
  it("bills precisely what the allocation allocated", () => {
    const participants = 8;
    const profile = illustrativeDayProfile({ kwp: 20, dailyConsumptionKwh: 8, participants });
    const shares = illustrativeShares(participants);
    const allocation = allocate({
      key: "cascading",
      generationKwh: profile.generationKwh,
      participants: profile.consumptionKwh.map((c, i) => ({
        id: `we-${i + 1}`,
        share: shares[i],
        consumptionKwh: c,
      })),
    });

    const bill = billPeriod({
      period: { from: "2026-06-01", to: "2026-06-02" },
      tariff: { ...TARIFF, grundversorgungCtPerKwh: 36 },
      participants: allocation.participants.map((p) => ({
        id: p.id,
        allocatedKwh: p.allocatedKwh,
        gridDrawKwh: p.gridDrawKwh,
      })),
    });

    expect(bill.totals.allocatedKwh).toBeCloseTo(allocation.totals.allocatedKwh, 9);
    expect(bill.totals.consumptionKwh).toBeCloseTo(allocation.totals.consumptionKwh, 9);
    expect(reconcile(bill).ok).toBe(true);
    expect(bill.totals.savingVsGrundversorgungCents!).toBeGreaterThan(0);
  });
});
