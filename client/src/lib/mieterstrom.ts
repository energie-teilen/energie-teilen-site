/**
 * client/src/lib/mieterstrom.ts
 *
 * Pure Mieterstrom economics: 20-year cashflow model, NPV, IRR (Newton-Raphson),
 * and amortisation. Extracted verbatim from Home.tsx so the math is unit-testable
 * in isolation (see mieterstrom.test.ts). No React, no DOM, no side effects.
 */

import type { MieterstromInputs } from "../../../shared/schema";

export type MieterstromYear = {
  jahr: number;
  ertragKwh: number;
  eigenverbrauchKwh: number;
  einspeisungKwh: number;
  cashflowEur: number;
  kumulierterCashflowEur: number;
};

export type MieterstromResult = {
  inputs: MieterstromInputs;
  jahre: MieterstromYear[];
  kpis: {
    investitionEur: number;
    amortisationsdauerJahre: number | null;
    npvEur: number;
    irrPct: number | null;
    erlosKumEur: number;
    co2EinsparungT: number;
  };
};

export const DEFAULTS: MieterstromInputs = {
  kwp: 30,
  anzahlWohneinheiten: 12,
  eigenverbrauchsquote: 0.45,
  strompreisMieterCtPerKwh: 32,
  mieterstromZuschlagCtPerKwh: 2.5,
  einspeiseverguetungCtPerKwh: 7.86,
  investitionEurPerKwp: 1400,
  betriebskostenEurPerKwpJahr: 20,
  laufzeitJahre: 20,
  diskontierungssatz: 0.04,
  degradationPctPerJahr: 0.005,
  spezifischerErtragKwhPerKwp: 950,
};

export const CO2_FACTOR_DE_T_PER_MWH = 0.38;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// Pure function — same math regardless of how many scenarios you run in parallel.
export function calculateMieterstrom(inputs: MieterstromInputs): MieterstromResult {
  const investitionEur = inputs.investitionEurPerKwp * inputs.kwp;
  const jahre: MieterstromYear[] = [];
  let kumulierterCashflow = -investitionEur;
  let npv = -investitionEur;

  for (let j = 1; j <= inputs.laufzeitJahre; j++) {
    const degradation = (1 - inputs.degradationPctPerJahr) ** (j - 1);
    const ertragKwh =
      inputs.kwp * inputs.spezifischerErtragKwhPerKwp * degradation;
    const eigenverbrauchKwh = ertragKwh * inputs.eigenverbrauchsquote;
    const einspeisungKwh = ertragKwh - eigenverbrauchKwh;

    const erloesMieterstrom =
      (eigenverbrauchKwh * inputs.strompreisMieterCtPerKwh) / 100;
    const erloesZuschlag =
      (eigenverbrauchKwh * inputs.mieterstromZuschlagCtPerKwh) / 100;
    const erloesEinspeisung =
      (einspeisungKwh * inputs.einspeiseverguetungCtPerKwh) / 100;
    const betriebskosten =
      inputs.betriebskostenEurPerKwpJahr * inputs.kwp * (1 + 0.02) ** (j - 1);

    const cashflow =
      erloesMieterstrom + erloesZuschlag + erloesEinspeisung - betriebskosten;
    kumulierterCashflow += cashflow;
    npv += cashflow / (1 + inputs.diskontierungssatz) ** j;

    jahre.push({
      jahr: j,
      ertragKwh: round2(ertragKwh),
      eigenverbrauchKwh: round2(eigenverbrauchKwh),
      einspeisungKwh: round2(einspeisungKwh),
      cashflowEur: round2(cashflow),
      kumulierterCashflowEur: round2(kumulierterCashflow),
    });
  }

  const amortisation = findAmortisation(jahre);
  const irr = calculateIRR(
    jahre.map((j) => j.cashflowEur),
    investitionEur,
  );
  const erlosKumEur = jahre.reduce((s, j) => s + j.cashflowEur, 0) + investitionEur;
  const totalEigenverbrauchKwh = jahre.reduce((s, j) => s + j.eigenverbrauchKwh, 0);

  return {
    inputs,
    jahre,
    kpis: {
      investitionEur: round2(investitionEur),
      amortisationsdauerJahre: amortisation,
      npvEur: round2(npv),
      irrPct: irr === null ? null : round2(irr * 100),
      erlosKumEur: round2(erlosKumEur),
      co2EinsparungT: round2((totalEigenverbrauchKwh / 1000) * CO2_FACTOR_DE_T_PER_MWH),
    },
  };
}

export function findAmortisation(jahre: MieterstromYear[]): number | null {
  for (let i = 0; i < jahre.length; i++) {
    const j = jahre[i];
    if (j.kumulierterCashflowEur >= 0) {
      const prev = i > 0 ? jahre[i - 1] : null;
      if (!prev || prev.kumulierterCashflowEur >= 0) return j.jahr;
      const fraction =
        Math.abs(prev.kumulierterCashflowEur) /
        (Math.abs(prev.kumulierterCashflowEur) + j.kumulierterCashflowEur);
      return round2(prev.jahr + fraction);
    }
  }
  return null;
}

// Newton-Raphson IRR
export function calculateIRR(cashflows: number[], investition: number): number | null {
  let r = 0.1;
  for (let iter = 0; iter < 80; iter++) {
    let npv = -investition;
    let derivative = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const t = i + 1;
      const cf = cashflows[i];
      npv += cf / (1 + r) ** t;
      derivative -= (t * cf) / (1 + r) ** (t + 1);
    }
    if (Math.abs(npv) < 0.01) return r;
    if (derivative === 0) return null;
    const next = r - npv / derivative;
    if (!Number.isFinite(next) || next < -0.99) return null;
    r = next;
  }
  return null;
}
