import { describe, it, expect } from "vitest";
import {
  ALLOCATION_DISCLAIMER_DE,
  AllocationError,
  AllocationInputSchema,
  ILLUSTRATIVE_PROFILE_DISCLAIMER_DE,
  INTERVALS_PER_DAY,
  INTERVAL_MINUTES,
  allocate,
  compareKeys,
  illustrativeDayProfile,
  illustrativeShares,
  type AllocationInput,
  type AllocationKey,
} from "../../../shared/allocation";

const KEYS: AllocationKey[] = ["static", "dynamic", "cascading"];

/** Two participants, four intervals, deliberately mismatched profiles. */
function twoParty(key: AllocationKey): AllocationInput {
  return {
    key,
    generationKwh: [0, 4, 10, 2],
    participants: [
      { id: "a", share: 0.5, consumptionKwh: [1, 1, 1, 1] },
      { id: "b", share: 0.5, consumptionKwh: [1, 5, 5, 1] },
    ],
  };
}

describe("energy conservation", () => {
  it.each(KEYS)("closes the balance exactly for the %s key", (key) => {
    const r = allocate(twoParty(key));
    expect(r.totals.allocatedKwh + r.totals.feedInKwh).toBeCloseTo(r.totals.generationKwh, 12);
  });

  it.each(KEYS)("closes the balance in every interval for the %s key", (key) => {
    const r = allocate(twoParty(key), { includeSeries: true });
    for (let t = 0; t < r.totals.intervals; t++) {
      const allocated = r.participants.reduce((s, p) => s + p.series![t], 0);
      expect(allocated + r.feedInSeries![t]).toBeCloseTo(r.generationSeries![t], 12);
    }
  });

  it.each(KEYS)("never allocates more than a participant consumed (%s)", (key) => {
    const r = allocate(twoParty(key), { includeSeries: true });
    for (const p of r.participants) {
      expect(p.allocatedKwh).toBeLessThanOrEqual(p.consumptionKwh + 1e-12);
      expect(p.gridDrawKwh).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it.each(KEYS)("never allocates more than was generated (%s)", (key) => {
    const r = allocate(twoParty(key));
    expect(r.totals.allocatedKwh).toBeLessThanOrEqual(r.totals.generationKwh + 1e-12);
    expect(r.totals.feedInKwh).toBeGreaterThanOrEqual(-1e-12);
  });

  it("holds the balance across a full year of intervals", () => {
    const n = 4 * 24 * 365;
    const generationKwh = Array.from({ length: n }, (_, t) => (t % 96 > 24 && t % 96 < 72 ? 0.9 : 0));
    const r = allocate({
      key: "cascading",
      generationKwh,
      participants: [
        { id: "a", share: 0.4, consumptionKwh: Array.from({ length: n }, () => 0.3) },
        { id: "b", share: 0.6, consumptionKwh: Array.from({ length: n }, (_, t) => (t % 3 === 0 ? 1.2 : 0.1)) },
      ],
    });
    expect(r.totals.allocatedKwh + r.totals.feedInKwh).toBeCloseTo(r.totals.generationKwh, 6);
  });
});

describe("static key", () => {
  it("caps each participant at their agreed share of the interval", () => {
    // Interval 2: 10 kWh generated, a is capped by its 1 kWh demand, b by its
    // 50 % share of 10 kWh = 5 kWh, which exactly meets its 5 kWh demand.
    const r = allocate(twoParty("static"), { includeSeries: true });
    expect(r.participants[0].series![2]).toBeCloseTo(1, 12);
    expect(r.participants[1].series![2]).toBeCloseTo(5, 12);
    expect(r.feedInSeries![2]).toBeCloseTo(4, 12);
  });

  it("leaves energy unplaced when one participant's share exceeds their demand", () => {
    const r = allocate(twoParty("static"));
    expect(r.totals.feedInKwh).toBeGreaterThan(0);
  });

  it("reports the agreed share back on each participant", () => {
    const r = allocate(twoParty("static"));
    expect(r.participants.map((p) => p.share)).toEqual([0.5, 0.5]);
  });
});

describe("dynamic key", () => {
  it("gives every participant the same coverage ratio while generation is scarce", () => {
    const r = allocate({
      key: "dynamic",
      generationKwh: [3],
      participants: [
        { id: "a", consumptionKwh: [2] },
        { id: "b", consumptionKwh: [4] },
      ],
    });
    expect(r.participants[0].coverageRate).toBeCloseTo(0.5, 12);
    expect(r.participants[1].coverageRate).toBeCloseTo(0.5, 12);
  });

  it("covers everyone fully once generation exceeds total demand", () => {
    const r = allocate({
      key: "dynamic",
      generationKwh: [10],
      participants: [
        { id: "a", consumptionKwh: [2] },
        { id: "b", consumptionKwh: [4] },
      ],
    });
    expect(r.totals.allocatedKwh).toBeCloseTo(6, 12);
    expect(r.totals.feedInKwh).toBeCloseTo(4, 12);
  });

  it("does not report a share, because it does not use one", () => {
    const r = allocate(twoParty("dynamic"));
    expect(r.participants.every((p) => p.share === null)).toBe(true);
  });

  it("allocates nothing when nobody is consuming", () => {
    const r = allocate({
      key: "dynamic",
      generationKwh: [5],
      participants: [{ id: "a", consumptionKwh: [0] }],
    });
    expect(r.totals.allocatedKwh).toBe(0);
    expect(r.totals.feedInKwh).toBeCloseTo(5, 12);
    expect(r.participants[0].coverageRate).toBeNull();
  });
});

describe("cascading key", () => {
  it("redistributes the unused remainder to unmet demand", () => {
    // Same interval as the static case: the 4 kWh a cannot use goes to b, which
    // still has 5 kWh of demand and only received 5 of it.
    const r = allocate(twoParty("cascading"), { includeSeries: true });
    expect(r.participants[0].series![2]).toBeCloseTo(1, 12);
    expect(r.participants[1].series![2]).toBeCloseTo(5, 12);
    expect(r.feedInSeries![2]).toBeCloseTo(4, 12);
  });

  it("places strictly more than the static key when shares are mismatched", () => {
    const input = {
      generationKwh: [10],
      participants: [
        { id: "a", share: 0.8, consumptionKwh: [1] },
        { id: "b", share: 0.2, consumptionKwh: [9] },
      ],
    };
    const stat = allocate({ ...input, key: "static" });
    const casc = allocate({ ...input, key: "cascading" });
    expect(stat.totals.allocatedKwh).toBeCloseTo(3, 12); // 1 + 2
    expect(casc.totals.allocatedKwh).toBeCloseTo(10, 12); // 1 + 9
    expect(casc.totals.allocatedKwh).toBeGreaterThan(stat.totals.allocatedKwh);
  });

  it("never places more than the total demand", () => {
    const r = allocate({
      key: "cascading",
      generationKwh: [100],
      participants: [
        { id: "a", share: 0.5, consumptionKwh: [1] },
        { id: "b", share: 0.5, consumptionKwh: [2] },
      ],
    });
    expect(r.totals.allocatedKwh).toBeCloseTo(3, 12);
    expect(r.totals.feedInKwh).toBeCloseTo(97, 12);
  });

  it("terminates with many participants and a single dominant share", () => {
    const n = 50;
    const demand = 0.1 + 3 * (n - 1);
    const participants = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      share: i === 0 ? 0.51 : 0.49 / (n - 1),
      consumptionKwh: [i === 0 ? 0.1 : 3],
    }));

    // Enough generation: every participant ends fully covered despite one
    // holding a majority share they cannot use.
    const ample = allocate({ key: "cascading", generationKwh: [demand * 2], participants });
    expect(ample.totals.allocatedKwh).toBeCloseTo(demand, 9);

    // Scarce generation: everything generated is placed, nothing more.
    const scarce = allocate({ key: "cascading", generationKwh: [100], participants });
    expect(scarce.totals.allocatedKwh).toBeCloseTo(100, 9);
    expect(scarce.totals.feedInKwh).toBeCloseTo(0, 9);
  });
});

describe("key comparison", () => {
  it("runs every key against one dataset", () => {
    const r = compareKeys({
      generationKwh: [10],
      participants: [
        { id: "a", share: 0.8, consumptionKwh: [1] },
        { id: "b", share: 0.2, consumptionKwh: [9] },
      ],
    });
    expect(Object.keys(r).sort()).toEqual(["cascading", "dynamic", "static"]);
    expect(r.cascading.totals.selfConsumptionRate).toBeGreaterThan(
      r.static.totals.selfConsumptionRate,
    );
  });

  it("keeps every key's balance closed", () => {
    const r = compareKeys({
      generationKwh: [0, 4, 10, 2],
      participants: [
        { id: "a", share: 0.5, consumptionKwh: [1, 1, 1, 1] },
        { id: "b", share: 0.5, consumptionKwh: [1, 5, 5, 1] },
      ],
    });
    for (const key of KEYS) {
      expect(r[key].totals.allocatedKwh + r[key].totals.feedInKwh).toBeCloseTo(16, 12);
    }
  });
});

describe("rates", () => {
  it("computes self-consumption against generation and autarky against demand", () => {
    const r = allocate({
      key: "dynamic",
      generationKwh: [10],
      participants: [{ id: "a", consumptionKwh: [4] }],
    });
    expect(r.totals.selfConsumptionRate).toBeCloseTo(0.4, 12);
    expect(r.totals.autarkyRate).toBeCloseTo(1, 12);
  });

  it("reports zero rather than dividing by zero when nothing was generated", () => {
    const r = allocate({
      key: "dynamic",
      generationKwh: [0, 0],
      participants: [{ id: "a", consumptionKwh: [1, 1] }],
    });
    expect(r.totals.selfConsumptionRate).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain("no_generation");
  });
});

describe("validation", () => {
  it("rejects a consumption series of the wrong length", () => {
    expect(() =>
      allocate({
        key: "dynamic",
        generationKwh: [1, 2, 3],
        participants: [{ id: "a", consumptionKwh: [1, 2] }],
      }),
    ).toThrow(AllocationError);
  });

  it("rejects duplicate participant ids", () => {
    expect(() =>
      allocate({
        key: "dynamic",
        generationKwh: [1],
        participants: [
          { id: "a", consumptionKwh: [1] },
          { id: "a", consumptionKwh: [1] },
        ],
      }),
    ).toThrow(/mehrfach/);
  });

  it("rejects shares summing above one", () => {
    expect(() =>
      allocate({
        key: "static",
        generationKwh: [1],
        participants: [
          { id: "a", share: 0.7, consumptionKwh: [1] },
          { id: "b", share: 0.7, consumptionKwh: [1] },
        ],
      }),
    ).toThrow(/100 %/);
  });

  it("rejects shares given for only some participants", () => {
    expect(() =>
      allocate({
        key: "static",
        generationKwh: [1],
        participants: [
          { id: "a", share: 0.5, consumptionKwh: [1] },
          { id: "b", consumptionKwh: [1] },
        ],
      }),
    ).toThrow(/alle Teilnehmer oder für keinen/);
  });

  it("splits equally when no shares are given, and says so", () => {
    const r = allocate({
      key: "static",
      generationKwh: [4],
      participants: [
        { id: "a", consumptionKwh: [4] },
        { id: "b", consumptionKwh: [4] },
      ],
    });
    expect(r.participants.map((p) => p.share)).toEqual([0.5, 0.5]);
    expect(r.warnings.map((w) => w.code)).toContain("shares_defaulted_equal");
  });

  it("permits shares below one and reports the shortfall", () => {
    const r = allocate({
      key: "static",
      generationKwh: [10],
      participants: [
        { id: "a", share: 0.3, consumptionKwh: [10] },
        { id: "b", share: 0.3, consumptionKwh: [10] },
      ],
    });
    expect(r.totals.allocatedKwh).toBeCloseTo(6, 12);
    expect(r.warnings.map((w) => w.code)).toContain("shares_below_one");
  });

  it("rejects negative values and empty series at the schema boundary", () => {
    expect(() =>
      AllocationInputSchema.parse({
        key: "dynamic",
        generationKwh: [-1],
        participants: [{ id: "a", consumptionKwh: [1] }],
      }),
    ).toThrow();
    expect(() =>
      AllocationInputSchema.parse({ key: "dynamic", generationKwh: [], participants: [] }),
    ).toThrow();
  });

  it("carries the disclaimer on every result", () => {
    for (const key of KEYS) {
      expect(allocate(twoParty(key)).disclaimer).toBe(ALLOCATION_DISCLAIMER_DE);
    }
  });
});

describe("illustrative profile", () => {
  it("produces a full day at the settlement resolution", () => {
    const p = illustrativeDayProfile({ kwp: 30, dailyConsumptionKwh: 8, participants: 6 });
    expect(p.generationKwh).toHaveLength(INTERVALS_PER_DAY);
    expect(INTERVALS_PER_DAY * INTERVAL_MINUTES).toBe(24 * 60);
    expect(p.consumptionKwh).toHaveLength(6);
    expect(p.consumptionKwh.every((c) => c.length === INTERVALS_PER_DAY)).toBe(true);
  });

  it("scales generation to the plant size and peak-sun hours", () => {
    const p = illustrativeDayProfile({
      kwp: 30,
      dailyConsumptionKwh: 8,
      participants: 2,
      peakSunHours: 4,
    });
    expect(p.generationKwh.reduce((s, v) => s + v, 0)).toBeCloseTo(120, 6);
  });

  it("generates nothing at night", () => {
    const p = illustrativeDayProfile({ kwp: 30, dailyConsumptionKwh: 8, participants: 2 });
    expect(p.generationKwh[0]).toBe(0);
    expect(p.generationKwh[INTERVALS_PER_DAY - 1]).toBe(0);
  });

  it("gives participants distinguishable profiles, so the keys differ", () => {
    const p = illustrativeDayProfile({ kwp: 30, dailyConsumptionKwh: 8, participants: 4 });
    expect(p.consumptionKwh[0]).not.toEqual(p.consumptionKwh[1]);

    const compared = compareKeys({
      generationKwh: p.generationKwh,
      participants: p.consumptionKwh.map((c, i) => ({ id: `p${i}`, share: 0.25, consumptionKwh: c })),
    });
    expect(compared.cascading.totals.allocatedKwh).toBeGreaterThan(
      compared.static.totals.allocatedKwh,
    );
  });

  it("is deterministic", () => {
    const args = { kwp: 30, dailyConsumptionKwh: 8, participants: 4 };
    expect(illustrativeDayProfile(args)).toEqual(illustrativeDayProfile(args));
  });

  it("produces shares that sum to one", () => {
    for (const n of [2, 3, 7, 12, 40]) {
      const shares = illustrativeShares(n);
      expect(shares).toHaveLength(n);
      expect(shares.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
      expect(shares.every((v) => v > 0)).toBe(true);
    }
  });

  // Shares that happen to track demand make every key produce the same answer,
  // which would misrepresent the choice as immaterial.
  it("produces shares that do not track the demand ordering", () => {
    const n = 12;
    const shares = illustrativeShares(n);
    const p = illustrativeDayProfile({ kwp: 30, dailyConsumptionKwh: 8, participants: n });
    const demand = p.consumptionKwh.map((c) => c.reduce((s, v) => s + v, 0));
    const rank = (a: number[]) =>
      a.map((_, i) => i).sort((x, y) => a[x] - a[y]).join(",");
    expect(rank(shares)).not.toBe(rank(demand));
  });

  it("makes the static key measurably worse than the others on that data", () => {
    const n = 12;
    const shares = illustrativeShares(n);
    const p = illustrativeDayProfile({ kwp: 30, dailyConsumptionKwh: 8, participants: n });
    const r = compareKeys({
      generationKwh: p.generationKwh,
      participants: p.consumptionKwh.map((c, i) => ({ id: `p${i}`, share: shares[i], consumptionKwh: c })),
    });
    expect(r.cascading.totals.allocatedKwh).toBeGreaterThan(r.static.totals.allocatedKwh);
    expect(r.dynamic.totals.allocatedKwh).toBeGreaterThan(r.static.totals.allocatedKwh);
  });

  it("states that it is not measurement", () => {
    expect(ILLUSTRATIVE_PROFILE_DISCLAIMER_DE).toMatch(/nicht um Messwerte/);
  });
});
