import { describe, it, expect } from "vitest";
import { interpret } from "./interpret";
import { calculateMieterstrom, DEFAULTS } from "./mieterstrom";
import type { MieterstromInputs } from "../../../shared/schema";

const run = (over: Partial<MieterstromInputs> = {}) => {
  const inputs = { ...DEFAULTS, ...over };
  return { inputs, out: interpret(inputs, calculateMieterstrom(inputs)) };
};

/**
 * The break-even sentence is prose a customer acts on. It used to read
 * "wirtschaftlich ab einer Investition von ~1506 €/kWp — aktuell 1210 €/kWp"
 * for a project already returning 13.6 % IRR: a threshold stated as though it
 * were an unmet hurdle. These tests pin the direction.
 */
describe("interpret — break-even direction", () => {
  it("frames the threshold as headroom when the target is already met", () => {
    const { inputs, out } = run({ investitionEurPerKwp: 1210, eigenverbrauchsquote: 0.52, kwp: 88 });
    const irr = calculateMieterstrom(inputs).kpis.irrPct!;
    expect(irr).toBeGreaterThan(10);
    expect(out.breakEven).toContain("bereits erreicht");
    expect(out.breakEven).toMatch(/solange/);
    expect(out.breakEven).not.toMatch(/^Wirtschaftlich \(10 % IRR\) ab/);
  });

  it("frames the threshold as a required move when the target is not met", () => {
    const { inputs, out } = run({ investitionEurPerKwp: 2600, eigenverbrauchsquote: 0.2 });
    const irr = calculateMieterstrom(inputs).kpis.irrPct;
    if (irr !== null && irr < 10) {
      expect(out.breakEven).toMatch(/werden erreicht, wenn|nicht erreichbar/);
      expect(out.breakEven).not.toContain("bereits erreicht");
    }
  });

  it("always states the current value alongside the threshold", () => {
    const { out } = run();
    expect(out.breakEven).toMatch(/aktuell|nicht erreichbar/);
  });
});

describe("interpret — benchmark honesty", () => {
  it("does not present the internal band as a market benchmark", () => {
    const { out } = run();
    expect(out.benchmark).toContain("Orientierungsbereich");
    expect(out.benchmark).toContain("ohne belegte Datengrundlage");
    expect(out.benchmark).not.toContain("Typische Mieterstrom-Projekte erreichen");
  });
});

describe("interpret — verdict", () => {
  it("names an actionable lever, never geography or a regulated rate", () => {
    const { out } = run();
    expect(out.verdict).not.toContain("Spez. Ertrag");
    expect(out.verdict).toMatch(/Hebel/);
  });
});
