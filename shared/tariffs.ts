/**
 * shared/tariffs.ts
 *
 * SOURCED REGULATORY VALUES — and the regime clock running against them.
 *
 * Every number the calculator used for regulated rates was a scalar guess:
 *   - Einspeisevergütung 7,86 ct/kWh, against an actual 6,66 for a 30 kWp
 *     plant in the current window. The model overstated feed-in revenue for
 *     every project in the 10–40 kWp band, which is most of them.
 *   - Mieterstromzuschlag 2,50 ct/kWh, size-independent, when the rate is
 *     banded and falls to 1,29 above 40 kWp.
 *   - CO2 factor 0,38 t/MWh, against the Umweltbundesamt figure of 0,344 for
 *     2025 — a 10 % overstatement of the headline environmental number.
 *
 * Worse than any individual figure: all three are BANDED BY PLANT SIZE and the
 * engine took a single scalar, so entering a different kWp silently kept a rate
 * that belonged to a different plant.
 *
 * And the assumption underneath all of it has an expiry date. See
 * FIXED_TARIFF_REGIME below.
 *
 * Rule for this file: a value is only `verified: true` when it was read from
 * the body that publishes it. Values taken from a secondary summary of an
 * official rate carry the reference and the date but stay unverified, because
 * "someone reported the regulator's number" is not the same claim as "the
 * regulator published this number".
 */

// ============================================================================
// SIZE-BANDED RATES
// ============================================================================

export type TariffBand = {
  /** Upper bound of the band in kWp, inclusive. */
  maxKwp: number;
  ctPerKwh: number;
};

export type TariffTable = {
  bands: TariffBand[];
  /** Rate above the largest band, if the schedule extends. Null = out of scope. */
  aboveTopBandCtPerKwh: number | null;
  validFrom: string;
  validUntil: string | null;
  legalBasis: string;
  reference: string;
  asOf: string;
  verified: boolean;
  note?: string;
};

/**
 * EEG feed-in tariff, Teileinspeisung (surplus feed-in) — the mode a
 * Mieterstrom plant is in, since the building consumes first.
 *
 * Rates step down half-yearly. The window matters: quoting a rate without its
 * validity period is how a report goes stale without anyone noticing.
 */
export const FEED_IN_TARIFF: TariffTable = {
  bands: [
    { maxKwp: 10, ctPerKwh: 7.7 },
    { maxKwp: 40, ctPerKwh: 6.66 },
    { maxKwp: 100, ctPerKwh: 5.44 },
  ],
  aboveTopBandCtPerKwh: null,
  validFrom: "2026-08-01",
  validUntil: "2027-01-31",
  legalBasis: "§§ 21, 49 EEG 2023",
  reference:
    "Bundesnetzagentur, halbjährlich veröffentlichte Fördersätze (Sekundärquelle: logicenergy.de/neuigkeiten/eeg-verguetung-2026)",
  asOf: "2026-09-06",
  // Read from a secondary summary, not from the BNetzA publication itself.
  verified: false,
  note: "Vor Verwendung gegen die aktuelle BNetzA-Veröffentlichung prüfen. Sätze sinken halbjährlich; der nächste Schritt ist zum 1. Februar 2027 angekündigt.",
};

/**
 * Mieterstromzuschlag under § 21 Abs. 3 EEG 2023 — paid on top of the tenant
 * supply, not on feed-in.
 */
export const MIETERSTROM_ZUSCHLAG: TariffTable = {
  bands: [
    { maxKwp: 10, ctPerKwh: 2.54 },
    { maxKwp: 40, ctPerKwh: 2.36 },
    { maxKwp: 100, ctPerKwh: 1.29 },
  ],
  aboveTopBandCtPerKwh: null,
  validFrom: "2026-01-01",
  validUntil: null,
  legalBasis: "§ 21 Abs. 3 EEG 2023",
  reference: "Sekundärquelle: volt-e.de/mieterstromzuschlag-2026",
  asOf: "2026-09-06",
  verified: false,
  note: "Degression von rund 1 % monatlich. Der maßgebliche Satz richtet sich nach dem Inbetriebnahmedatum, nicht nach dem Berechnungsdatum.",
};

/**
 * Look up the banded rate for a plant size.
 *
 * Returns null above the top band rather than extrapolating: a plant outside
 * the published schedule is a case for a human, not for a guess.
 */
export function lookupRate(table: TariffTable, kwp: number): number | null {
  if (!Number.isFinite(kwp) || kwp <= 0) return null;
  for (const band of table.bands) {
    if (kwp <= band.maxKwp) return band.ctPerKwh;
  }
  return table.aboveTopBandCtPerKwh;
}

export function bandLabel(table: TariffTable, kwp: number): string {
  let lower = 0;
  for (const band of table.bands) {
    if (kwp <= band.maxKwp) return `${lower}–${band.maxKwp} kWp`;
    lower = band.maxKwp;
  }
  return `> ${lower} kWp`;
}

// ============================================================================
// PRICE CAP
// ============================================================================

/**
 * A Mieterstrom price may not exceed this share of the local basic-supply
 * tariff. The engine does not model it, so the most common way a project fails
 * compliance was invisible in the numbers.
 */
export const MIETERSTROM_PRICE_CAP_SHARE = 0.9;

/**
 * The legal basis is the Mieterstrom model itself, so it is referenced through
 * the model register rather than restated here. One claim, one home.
 */
export const PRICE_CAP_SOURCE = {
  legalModelId: "mieterstrom" as const,
  reference: "Sekundärquelle: reduco.ai/blog/mieterstrom-pv-mehrfamilienhaus",
  asOf: "2026-09-06",
  verified: false,
};

/**
 * The highest Mieterstrom price allowed against a given basic-supply tariff.
 * Both in ct/kWh.
 */
export function maxMieterstromPrice(grundversorgungCtPerKwh: number): number {
  return Math.round(grundversorgungCtPerKwh * MIETERSTROM_PRICE_CAP_SHARE * 100) / 100;
}

/**
 * Is the modelled tenant price plausibly above the cap?
 *
 * Without the local basic-supply tariff we cannot decide, so this answers
 * "unknown" rather than inventing a reference price — the same discipline the
 * eligibility engine uses for missing facts.
 */
export function priceCapCheck(
  tenantPriceCtPerKwh: number,
  grundversorgungCtPerKwh?: number,
): { status: "ok" | "over_cap" | "unknown"; capCtPerKwh: number | null } {
  if (grundversorgungCtPerKwh === undefined || !Number.isFinite(grundversorgungCtPerKwh)) {
    return { status: "unknown", capCtPerKwh: null };
  }
  const cap = maxMieterstromPrice(grundversorgungCtPerKwh);
  return { status: tenantPriceCtPerKwh > cap ? "over_cap" : "ok", capCtPerKwh: cap };
}

// ============================================================================
// THE REGIME CLOCK — the assumption with an expiry date
// ============================================================================

/**
 * The 20-year cashflow model rests on a fixed feed-in tariff running for the
 * whole term. That regime is being abolished.
 *
 * The EEG 2027 draft ends the fixed Einspeisevergütung for NEW plants and
 * replaces it with mandatory direct marketing:
 *   < 25 kW    — no EEG support at all, and a permanent cap of feed-in power
 *                at 50 % of rated capacity
 *   25–100 kW  — market-value pass-through, no subsidy element
 *   ≥ 100 kW   — two-sided CfD with an annual claw-back of excess earnings
 *
 * For any plant commissioned under that regime, this model is not merely
 * miscalibrated — its revenue structure is the wrong shape. The report has to
 * say so rather than quietly projecting a tariff that will not exist.
 *
 * Note what this does NOT mean: it makes self-consumption worth MORE, not less.
 * Feed-in revenue is what is being withdrawn; electricity consumed in the
 * building is untouched. The wedge points at the right thing.
 */
export const FIXED_TARIFF_REGIME = {
  /** Last commissioning year for which a fixed tariff is safely assumable. */
  lastReliableCommissioningYear: 2026,
  legalBasis: "EEG 2027 (Regierungsentwurf)",
  reference:
    "Sekundärquellen: bbh-blog.de (EEG 2027 – Abschaffung Einspeisevergütung und neue CfD-Regel), goerg.de (Arbeitsentwurf EEG 2027)",
  asOf: "2026-09-06",
  verified: false,
  summary:
    "Der Regierungsentwurf zum EEG 2027 schafft die feste Einspeisevergütung für Neuanlagen ab und ersetzt sie durch verpflichtende Direktvermarktung. Anlagen unter 25 kW verlieren die EEG-Förderung vollständig; 25–100 kW erhalten eine Marktwertdurchleitung ohne Förderelement; ab 100 kW gilt ein zweiseitiger CfD mit jährlichem Refinanzierungsbeitrag.",
} as const;

export type RegimeWarning = {
  applies: boolean;
  headline: string;
  detail: string;
};

/**
 * Does the fixed-tariff assumption still hold for a plant commissioned in this
 * year? `undefined` means the customer has not said, which is itself worth
 * flagging once the horizon is this close.
 */
export function regimeWarning(commissioningYear?: number): RegimeWarning {
  const cutoff = FIXED_TARIFF_REGIME.lastReliableCommissioningYear;

  if (commissioningYear === undefined) {
    return {
      applies: true,
      headline: "Inbetriebnahmejahr nicht angegeben",
      detail:
        `Diese Rechnung unterstellt eine feste Einspeisevergütung über die gesamte Laufzeit. ` +
        `Für Anlagen, die nach ${cutoff} in Betrieb gehen, ist diese Annahme nicht mehr belastbar: ` +
        FIXED_TARIFF_REGIME.summary +
        ` Der Eigenverbrauchsanteil ist davon nicht betroffen und gewinnt relativ an Bedeutung.`,
    };
  }

  if (commissioningYear > cutoff) {
    return {
      applies: true,
      headline: `Inbetriebnahme ${commissioningYear}: feste Einspeisevergütung nicht mehr unterstellbar`,
      detail:
        `${FIXED_TARIFF_REGIME.summary} ` +
        `Der Einspeiseerlös in dieser Rechnung ist daher strukturell zu optimistisch. ` +
        `Der Eigenverbrauchsanteil ist davon nicht betroffen und gewinnt relativ an Bedeutung.`,
    };
  }

  return {
    applies: false,
    headline: "Feste Einspeisevergütung unterstellbar",
    detail: `Für eine Inbetriebnahme bis einschließlich ${cutoff} ist die Annahme einer festen Einspeisevergütung vertretbar.`,
  };
}

// ============================================================================
// EMISSIONS
// ============================================================================

/**
 * Specific CO2 emissions of the German electricity mix.
 *
 * Read directly from the Umweltbundesamt publication, which is the body that
 * publishes it — so this one is verified. The previous 0,38 t/MWh overstated
 * the headline environmental figure by roughly 10 %.
 */
export const CO2_FACTOR = {
  tPerMwh: 0.344,
  year: 2025,
  reference:
    "Umweltbundesamt, „CO₂-Emissionen pro Kilowattstunde Strom 2025 nur leicht gesunken“ (344 g/kWh), veröffentlicht 23.03.2026",
  asOf: "2026-09-06",
  verified: true,
  note: "Der Faktor sinkt jährlich (2024: 353 g/kWh). Eine über 20 Jahre konstante Fortschreibung überschätzt die Einsparung tendenziell.",
} as const;
