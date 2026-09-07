import { describe, it, expect } from "vitest";
import {
  calculateMieterstrom,
  findAmortisation,
  calculateIRR,
  DEFAULTS,
  type MieterstromYear,
} from "./mieterstrom";

/**
 * Reference KPIs for the DEFAULTS case were derived from an INDEPENDENT
 * reimplementation of the model (not a copy of the function under test).
 *
 * Re-derived 2026-09-06 after the regulated defaults were corrected against
 * their published sources (see shared/tariffs.ts):
 *   Einspeisevergütung  7,86 → 6,66 ct/kWh  (BNetzA band 10–40 kWp)
 *   Mieterstromzuschlag 2,50 → 2,36 ct/kWh  (§ 21 Abs. 3 EEG 2023, same band)
 *   CO2-Faktor          0,38 → 0,344 t/MWh  (Umweltbundesamt, 2025)
 *
 * The engine math is unchanged; only its inputs were wrong. The correction
 * moves the headline default case by:
 *   NPV   22.151,81 → 19.463,26 €   (−12,1 %)
 *   IRR        9,56 → 8,94 %
 *   CO2       92,98 → 84,17 t       (−9,5 %)
 * The site had been overstating its own default scenario by roughly a tenth.
 */
describe("calculateMieterstrom — DEFAULTS base case", () => {
  const r = calculateMieterstrom(DEFAULTS);

  it("computes investition as €/kWp × kWp", () => {
    expect(r.kpis.investitionEur).toBe(42000);
  });

  it("NPV matches the independent reference (€19,463.26)", () => {
    expect(r.kpis.npvEur).toBeCloseTo(19463.26, 1);
    expect(r.kpis.npvEur).toBeGreaterThan(0);
  });

  it("IRR matches a hand-computed reference within 0.1%", () => {
    expect(r.kpis.irrPct).not.toBeNull();
    expect(r.kpis.irrPct as number).toBeCloseTo(8.94, 1);
  });

  it("amortisation interpolates to ~8.95 years", () => {
    expect(r.kpis.amortisationsdauerJahre).toBeCloseTo(8.95, 1);
  });

  it("CO2 saving matches reference (~84.17 t)", () => {
    expect(r.kpis.co2EinsparungT).toBeCloseTo(84.17, 1);
  });

  it("produces one row per Laufzeitjahr, numbered 1..N", () => {
    expect(r.jahre).toHaveLength(DEFAULTS.laufzeitJahre);
    expect(r.jahre[0].jahr).toBe(1);
    expect(r.jahre.at(-1)!.jahr).toBe(DEFAULTS.laufzeitJahre);
  });

  it("applies panel degradation: yield strictly decreases year over year", () => {
    for (let i = 1; i < r.jahre.length; i++) {
      expect(r.jahre[i].ertragKwh).toBeLessThan(r.jahre[i - 1].ertragKwh);
    }
  });
});

describe("findAmortisation", () => {
  it("returns null when cumulative cashflow never turns positive", () => {
    const neverPositive: MieterstromYear[] = Array.from({ length: 20 }, (_, i) => ({
      jahr: i + 1, ertragKwh: 0, eigenverbrauchKwh: 0, einspeisungKwh: 0,
      cashflowEur: -100, kumulierterCashflowEur: -100 * (i + 1),
    }));
    expect(findAmortisation(neverPositive)).toBeNull();
  });

  it("returns the first year when already non-negative at year 1", () => {
    const positiveFromStart: MieterstromYear[] = [
      { jahr: 1, ertragKwh: 0, eigenverbrauchKwh: 0, einspeisungKwh: 0, cashflowEur: 5, kumulierterCashflowEur: 5 },
    ];
    expect(findAmortisation(positiveFromStart)).toBe(1);
  });
});

describe("calculateIRR", () => {
  it("returns null when there is never a positive cashflow", () => {
    expect(calculateIRR([-50, -50, -50], 1000)).toBeNull();
  });

  it("finds ~0% IRR when inflows merely repay the investment with no gain", () => {
    const irr = calculateIRR(Array(10).fill(100), 1000);
    expect(irr).not.toBeNull();
    expect(irr as number).toBeCloseTo(0, 2);
  });
});

describe("NPV monotonicity property", () => {
  it("a higher discount rate yields a lower NPV", () => {
    const low = calculateMieterstrom({ ...DEFAULTS, diskontierungssatz: 0.02 });
    const high = calculateMieterstrom({ ...DEFAULTS, diskontierungssatz: 0.08 });
    expect(high.kpis.npvEur).toBeLessThan(low.kpis.npvEur);
  });
});
