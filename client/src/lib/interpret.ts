/**
 * interpret.ts — turns KPIs into plain-German guidance the customer understands.
 * Verdict + break-even + benchmark, all from the deterministic engine we tested.
 * The prose "lever" is restricted to ACTIONABLE inputs — never geography
 * (spez. Ertrag) or regulated rates the customer cannot change.
 */
import type { MieterstromInputs } from "../../../shared/schema";
import type { MieterstromResult } from "./mieterstrom";
import { sensitivity, solveForTarget } from "./sensitivity";

const num = (n: number, d = 1) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const eur = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
const BENCH_LOW = 6, BENCH_HIGH = 10; // typical Mieterstrom IRR band — indicative

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
  const sol = solveForTarget(inputs, topDriver.key, 10, "irrPct");
  const breakEven = sol.ok
    ? `Wirtschaftlich (10 % IRR) ab einer ${topDriver.label} von ~${fmt(topDriver.key, sol.value)} — aktuell ${fmt(topDriver.key, inputs[topDriver.key] as number)}.`
    : `Ein 10-%-IRR-Ziel ist über die ${topDriver.label} allein im realistischen Bereich nicht erreichbar — mehrere Annahmen müssen gemeinsam verbessert werden.`;

  let where = "im typischen Bereich";
  if (irr !== null) where = irr < BENCH_LOW ? "unterdurchschnittlich" : irr > BENCH_HIGH ? "überdurchschnittlich" : "im typischen Bereich";
  const benchmark = `Typische Mieterstrom-Projekte erreichen ${BENCH_LOW}–${BENCH_HIGH} % IRR. Ihr realistisches Szenario: ${irr !== null ? `${num(irr, 1)} %` : "n/a"} (${where}). Indikativ, vom Berater zu prüfen.`;

  return { verdict, breakEven, benchmark };
}
