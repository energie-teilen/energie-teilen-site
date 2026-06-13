import { describe, it, expect } from "vitest";
import { sensitivity, solveForTarget } from "./sensitivity";
import { DEFAULTS, calculateMieterstrom } from "./mieterstrom";
describe("sensitivity", () => {
  const rows = sensitivity(DEFAULTS, "irrPct", 0.2);
  it("ranks drivers by swing desc", () => { expect(rows.length).toBe(7); for (let i=1;i<rows.length;i++) expect(rows[i-1].swing).toBeGreaterThanOrEqual(rows[i].swing); });
  it("self-consumption up → IRR up", () => { const r = rows.find(r=>r.key==="eigenverbrauchsquote")!; expect(r.high).toBeGreaterThan(r.low); });
  it("investment up → IRR down", () => { const r = rows.find(r=>r.key==="investitionEurPerKwp")!; expect(r.high).toBeLessThan(r.low); });
});
describe("solveForTarget", () => {
  it("solves self-consumption for 12% IRR and it verifies", () => {
    const r = solveForTarget(DEFAULTS, "eigenverbrauchsquote", 12, "irrPct");
    expect(r.ok).toBe(true);
    if (r.ok) expect(calculateMieterstrom({ ...DEFAULTS, eigenverbrauchsquote: r.value }).kpis.irrPct!).toBeCloseTo(12, 0);
  });
  it("reports no solution for an unreachable target", () => { expect(solveForTarget(DEFAULTS, "eigenverbrauchsquote", 999).ok).toBe(false); });
});
