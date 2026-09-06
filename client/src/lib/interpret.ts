/**
 * interpret.ts — turns KPIs into plain-German guidance the customer understands.
 * Verdict + break-even + benchmark, all from the deterministic engine we tested.
 * The prose "lever" is restricted to ACTIONABLE inputs — never geography
 * (spez. Ertrag) or regulated rates the customer cannot change.
 */
import type { MieterstromInputs } from "../../../shared/schema";
import type { MieterstromResult } from "./mieterstrom";
import { sensitivity, solveForTarget } from "./sensitivity";
import { BENCHMARK_IRR_HIGH, BENCHMARK_IRR_LOW } from "../../../shared/assumptions";

const num = (n: number, d = 1) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const eur = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
// Single source of truth with shared/assumptions.ts, where this band is
// registered as a PLACEHOLDER: an internal orientation value with no sourced
// data behind it. The wording below must never imply otherwise.
const BENCH_LOW = BENCHMARK_IRR_LOW, BENCH_HIGH = BENCHMARK_IRR_HIGH;

export type Interpretation = { verdict: string; breakEven: string; benchmark: string };

export function interpret(inputs: MieterstromInputs, base: MieterstromResult): Interpretation {
  const irr = base.kpis.irrPct;
  const npv = base.kpis.npvEur;

  const ACTIONABLE = new Set<keyof MieterstromInputs>([
    "eigenverbrauchsquote", "strompreisMieterCtPerKwh", "investitionEurPerKwp", "betriebskostenEurPerKwpJahr",
  ]);
  const ranked = sensitivity(inputs, "irrPct", 0.2);
  const topDriver = ranked.find((r) => ACTIONABLE.has(r.key)) ?? ranked[0];

  const economic = npv > 0;
  const irrTxt = irr !== null ? `, IRR ${num(irr, 1)} %` : "";
  const verdict = economic
    ? `Bei diesen Annahmen ist das Projekt im realistischen Szenario wirtschaftlich (NPV ${eur(npv)}${irrTxt}). Der wichtigste Hebel ist die ${topDriver.label}.`
    : `Bei diesen Annahmen ist das Projekt im realistischen Szenario nicht wirtschaftlich (NPV ${eur(npv)}${irrTxt}). Der wichtigste Hebel zur Verbesserung ist die ${topDriver.label}.`;

  const fmt = (key: string, v: number) =>
    key === "eigenverbrauchsquote" ? `${Math.round(v * 100)} %`
    : key === "strompreisMieterCtPerKwh" ? `${num(v, 1)} ct/kWh`
    : key === "investitionEurPerKwp" ? `${Math.round(v)} €/kWp`
    : key === "betriebskostenEurPerKwpJahr" ? `${Math.round(v)} €/kWp·a`
    : `${num(v, 2)}`;
  // Direction matters. The old wording said "wirtschaftlich ab einer
  // Investition von ~1506 €/kWp — aktuell 1210 €/kWp" for a project ALREADY at
  // 13.6 % IRR, which reads as though the target were still out of reach. The
  // solved value is a threshold; whether you must go above or below it depends
  // on the driver, and whether you must move at all depends on where you are.
  const TARGET_IRR = 10;
  const sol = solveForTarget(inputs, topDriver.key, TARGET_IRR, "irrPct");
  const current = inputs[topDriver.key] as number;
  let breakEven: string;
  if (!sol.ok) {
    breakEven = `Ein Ziel von ${TARGET_IRR} % IRR ist über die ${topDriver.label} allein im realistischen Bereich nicht erreichbar — mehrere Annahmen müssen gemeinsam verbessert werden.`;
  } else if (irr !== null && irr >= TARGET_IRR) {
    // Already there: the threshold is headroom, not a hurdle.
    const side = sol.value > current ? "unter" : "über";
    breakEven = `Das Ziel von ${TARGET_IRR} % IRR ist bereits erreicht und bleibt erhalten, solange die ${topDriver.label} ${side} ~${fmt(topDriver.key, sol.value)} liegt — aktuell ${fmt(topDriver.key, current)}.`;
  } else {
    const verb = sol.value > current ? "steigt" : "sinkt";
    breakEven = `${TARGET_IRR} % IRR werden erreicht, wenn die ${topDriver.label} auf ~${fmt(topDriver.key, sol.value)} ${verb} — aktuell ${fmt(topDriver.key, current)}.`;
  }

  let where = "im Orientierungsbereich";
  if (irr !== null) where = irr < BENCH_LOW ? "darunter" : irr > BENCH_HIGH ? "darüber" : "im Orientierungsbereich";
  const benchmark = `Interner Orientierungsbereich: ${BENCH_LOW}–${BENCH_HIGH} % IRR. Ihr realistisches Szenario: ${irr !== null ? `${num(irr, 1)} %` : "n/a"} (${where}). Dieser Bereich ist ein Erfahrungswert ohne belegte Datengrundlage und keine Marktbenchmark.`;

  return { verdict, breakEven, benchmark };
}
