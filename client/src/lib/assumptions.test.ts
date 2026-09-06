import { describe, it, expect } from "vitest";
import {
  ASSUMPTION_SET,
  IMPLICIT_ASSUMPTIONS,
  MIETERSTROM_ASSUMPTIONS,
  MODEL_VERSION,
  buildCalculationStamp,
  formatStampLine,
  isPresentableAsFact,
  resolveAssumptions,
  resolveSource,
  unverifiedAssumptions,
  type MieterstromAssumptionKey,
} from "../../../shared/assumptions";
import { DEFAULTS } from "./mieterstrom";

const defaults = DEFAULTS as unknown as Record<MieterstromAssumptionKey, number>;

/**
 * The point of these tests is not the metadata itself — it is the invariant
 * that stops an unsourced number from ever being presented as a fact.
 */

describe("assumption register integrity", () => {
  it("covers every input the engine accepts, and nothing it does not", () => {
    expect(Object.keys(MIETERSTROM_ASSUMPTIONS).sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  // THE invariant. You cannot claim a value is verified without saying where
  // it came from and as of when.
  it("never marks a value verified without a reference and a date", () => {
    const all = [...Object.entries(MIETERSTROM_ASSUMPTIONS), ...Object.entries(IMPLICIT_ASSUMPTIONS)];
    for (const [key, meta] of all) {
      if (meta.verified) {
        expect(meta.reference, `${key} claims verified but has no reference`).not.toBeNull();
        expect(meta.asOf, `${key} claims verified but has no asOf date`).not.toBeNull();
      }
    }
  });

  it("treats a placeholder as unpresentable even if someone marks it verified", () => {
    expect(
      isPresentableAsFact({
        label: "x", unit: "", source: "PLACEHOLDER",
        reference: "irgendwo", asOf: "2026-01-01", verified: true,
      }),
    ).toBe(false);
  });

  it("declares the constants the engine applies but never exposed as inputs", () => {
    // The 2 %/a opex escalation and the CO2 factor shaped every result while
    // appearing nowhere in the UI or the report.
    expect(IMPLICIT_ASSUMPTIONS.betriebskostenInflation.value).toBe("2,0");
    expect(IMPLICIT_ASSUMPTIONS.co2Faktor.value).toBe("0,38");
    expect(IMPLICIT_ASSUMPTIONS.benchmarkIrrBand.source).toBe("PLACEHOLDER");
  });

  it("gives every entry a caveat a reader can act on", () => {
    for (const [key, meta] of Object.entries(MIETERSTROM_ASSUMPTIONS)) {
      expect(meta.note?.length ?? 0, `${key} has no note`).toBeGreaterThan(10);
    }
  });
});

describe("resolveSource — provenance belongs to a value, not a field", () => {
  it("keeps the declared source when the customer left the default alone", () => {
    expect(resolveSource("kwp", defaults.kwp, defaults)).toBe("PLACEHOLDER");
    expect(resolveSource("einspeiseverguetungCtPerKwh", defaults.einspeiseverguetungCtPerKwh, defaults)).toBe(
      "OFFICIAL_SOURCE",
    );
  });

  it("becomes a customer statement the moment the value is edited", () => {
    expect(resolveSource("kwp", defaults.kwp + 1, defaults)).toBe("CUSTOMER_PROVIDED");
    expect(resolveSource("eigenverbrauchsquote", 0.7, defaults)).toBe("CUSTOMER_PROVIDED");
  });
});

describe("resolveAssumptions", () => {
  it("marks an untouched report as almost entirely unverified", () => {
    const resolved = resolveAssumptions(defaults, defaults);
    expect(resolved).toHaveLength(Object.keys(DEFAULTS).length);
    // Nothing has been sourced yet, so nothing may be presented as established.
    expect(unverifiedAssumptions(resolved)).toHaveLength(resolved.length);
  });

  it("shrinks the unverified list exactly as the customer fills values in", () => {
    const edited = { ...defaults, kwp: 88, strompreisMieterCtPerKwh: 29.4, investitionEurPerKwp: 1210 };
    const resolved = resolveAssumptions(edited, defaults);
    const customerProvided = resolved.filter((r) => r.source === "CUSTOMER_PROVIDED");
    expect(customerProvided.map((r) => r.key).sort()).toEqual([
      "investitionEurPerKwp",
      "kwp",
      "strompreisMieterCtPerKwh",
    ]);
    expect(customerProvided.every((r) => r.verified)).toBe(true);
    expect(unverifiedAssumptions(resolved)).toHaveLength(resolved.length - 3);
  });

  it("carries a German source label for every row so the PDF needs no mapping", () => {
    for (const row of resolveAssumptions(defaults, defaults)) {
      expect(row.sourceLabel.length).toBeGreaterThan(3);
    }
  });
});

describe("calculation stamp", () => {
  it("pins model, assumption set, jurisdiction, currency, scenario and date", () => {
    const stamp = buildCalculationStamp("realistisch", new Date("2026-09-06T10:00:00Z"));
    expect(stamp).toEqual({
      modelVersion: MODEL_VERSION,
      assumptionSet: ASSUMPTION_SET,
      calculationDate: "2026-09-06T10:00:00.000Z",
      jurisdiction: "DE",
      currency: "EUR",
      scenario: "realistisch",
    });
  });

  it("renders a one-line stamp that makes two reports distinguishable", () => {
    const line = formatStampLine(buildCalculationStamp("realistisch", new Date("2026-09-06T10:00:00Z")));
    expect(line).toBe(
      `Modell ${MODEL_VERSION} · Annahmensatz ${ASSUMPTION_SET} · DE · EUR · Szenario realistisch · berechnet 2026-09-06`,
    );
  });

  it("is deterministic for a given clock", () => {
    const at = new Date("2026-09-06T10:00:00Z");
    expect(formatStampLine(buildCalculationStamp("realistisch", at))).toBe(
      formatStampLine(buildCalculationStamp("realistisch", at)),
    );
  });
});
