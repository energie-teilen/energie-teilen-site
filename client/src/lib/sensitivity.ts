import type { MieterstromInputs } from "../../../shared/schema";
import { calculateMieterstrom } from "./mieterstrom";

export type Kpi = "irrPct" | "npvEur";
export type SensitivityRow = { key: keyof MieterstromInputs; label: string; low: number; base: number; high: number; swing: number; };

const DRIVERS: { key: keyof MieterstromInputs; label: string }[] = [
  { key: "eigenverbrauchsquote", label: "Eigenverbrauchsquote" },
  { key: "strompreisMieterCtPerKwh", label: "Strompreis Mieter" },
  { key: "investitionEurPerKwp", label: "Investition" },
  { key: "spezifischerErtragKwhPerKwp", label: "Spez. Ertrag" },
  { key: "mieterstromZuschlagCtPerKwh", label: "Mieterstromzuschlag" },
  { key: "einspeiseverguetungCtPerKwh", label: "Einspeisevergütung" },
  { key: "betriebskostenEurPerKwpJahr", label: "Betriebskosten" },
];
const kpiValue = (i: MieterstromInputs, k: Kpi) => { const v = calculateMieterstrom(i).kpis[k]; return v === null ? 0 : v; };

export function sensitivity(base: MieterstromInputs, kpi: Kpi = "irrPct", pct = 0.2): SensitivityRow[] {
  const baseVal = kpiValue(base, kpi);
  return DRIVERS.map(({ key, label }) => {
    const clamp = (x: number) => key === "eigenverbrauchsquote" ? Math.min(0.95, Math.max(0.05, x)) : x;
    const low = kpiValue({ ...base, [key]: clamp((base[key] as number) * (1 - pct)) }, kpi);
    const high = kpiValue({ ...base, [key]: clamp((base[key] as number) * (1 + pct)) }, kpi);
    return { key, label, low, base: baseVal, high, swing: Math.abs(high - low) };
  }).sort((a, b) => b.swing - a.swing);
}

export type SolveResult = { ok: true; value: number; achievedKpi: number } | { ok: false; reason: "no-solution-in-range" };
export function solveForTarget(base: MieterstromInputs, key: keyof MieterstromInputs, target: number, kpi: Kpi = "irrPct", range?: [number, number]): SolveResult {
  const dr = (): [number, number] => key === "eigenverbrauchsquote" ? [0.05, 0.95] : key === "diskontierungssatz" ? [0, 0.15] : [(base[key] as number) * 0.4, (base[key] as number) * 2];
  const [lo, hi] = range ?? dr();
  const f = (x: number) => kpiValue({ ...base, [key]: x }, kpi) - target;
  let a = lo, b = hi, fa = f(a), fb = f(b);
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  if (fa === 0) return { ok: true, value: a, achievedKpi: target };
  if (fb === 0) return { ok: true, value: b, achievedKpi: target };
  if (fa * fb > 0) return { ok: false, reason: "no-solution-in-range" };
  for (let i = 0; i < 60; i++) { const m = (a + b) / 2, fm = f(m);
    if (Math.abs(fm) < 1e-4 || (b - a) / 2 < 1e-6) return { ok: true, value: r4(m), achievedKpi: r4(fm + target) };
    if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; } }
  return { ok: true, value: r4((a + b) / 2), achievedKpi: r4(f((a + b) / 2) + target) };
}
