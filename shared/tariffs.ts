/**
 * shared/tariffs.ts
 *
 * Regulated rates with their sources, validity windows and size bands.
 *
 * Einspeisevergütung, Mieterstromzuschlag and the CO2 factor are all banded by
 * plant size and change on published schedules, so each is held as a table with
 * an explicit validity window rather than as a constant.
 *
 * Sourcing rule: `verified: true` means the value was read from the body that
 * publishes it. A value taken from a secondary summary carries its reference
 * and date but stays unverified.
 *
 * FIXED_TARIFF_REGIME below records the horizon beyond which a fixed feed-in
 * tariff can no longer be assumed.
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
 * EEG feed-in tariff for Teileinspeisung (surplus feed-in), the mode a
 * Mieterstrom plant operates in since the building consumes first.
 *
 * Rates step down half-yearly, so the validity window is part of the value.
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
 * Look up the banded rate for a plant size. Returns null above the top band
 * rather than extrapolating beyond the published schedule.
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
 * tariff. Checked separately from the cashflow model.
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
 * Is the modelled tenant price above the cap?
 *
 * Without the local basic-supply tariff the question is undecidable, so the
 * result is "unknown" rather than a comparison against an invented reference.
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
 * The 20-year cashflow model assumes a fixed feed-in tariff for the full term.
 *
 * The EEG 2027 draft ends the fixed Einspeisevergütung for new plants and
 * replaces it with mandatory direct marketing:
 *   < 25 kW    — no EEG support at all, and a permanent cap of feed-in power
 *                at 50 % of rated capacity
 *   25–100 kW  — market-value pass-through, no subsidy element
 *   ≥ 100 kW   — two-sided CfD with an annual claw-back of excess earnings
 *
 * For a plant commissioned under that regime the model's revenue structure no
 * longer matches reality, so outputs carry an explicit warning.
 *
 * Only feed-in revenue is affected. Electricity consumed in the building is
 * untouched, which raises the relative weight of self-consumption.
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
 * Read directly from the Umweltbundesamt publication, so this entry is
 * verified.
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

// ============================================================================
// FRESHNESS
// ============================================================================

export type FreshnessStatus = "current" | "expiring" | "expired" | "open_ended";

export type Freshness = {
  status: FreshnessStatus;
  validFrom: string;
  validUntil: string | null;
  /** Days until validUntil. Null when the window is open-ended. */
  daysRemaining: number | null;
};

/** Inside this many days of expiry a rate is reported as "expiring". */
export const EXPIRY_WARNING_DAYS = 45;

const DAY_MS = 86_400_000;

/**
 * Where a dated table sits relative to its own validity window.
 *
 * Regulated rates step on published schedules. Reporting the window alongside
 * the value lets a caller decide whether the answer is still usable, and lets
 * the build fail before an expired rate ships.
 */
export function freshness(table: TariffTable, now: Date = new Date()): Freshness {
  if (table.validUntil === null) {
    return {
      status: "open_ended",
      validFrom: table.validFrom,
      validUntil: null,
      daysRemaining: null,
    };
  }

  // End of the closing day, so a table is current for all of validUntil.
  const endsAt = Date.parse(`${table.validUntil}T23:59:59Z`);
  const daysRemaining = Math.floor((endsAt - now.getTime()) / DAY_MS);

  const status: FreshnessStatus =
    daysRemaining < 0 ? "expired" : daysRemaining <= EXPIRY_WARNING_DAYS ? "expiring" : "current";

  return { status, validFrom: table.validFrom, validUntil: table.validUntil, daysRemaining };
}

/** Every dated table the product ships, for freshness reporting and CI. */
export const DATED_TABLES: Record<string, TariffTable> = {
  feedInTariff: FEED_IN_TARIFF,
  mieterstromZuschlag: MIETERSTROM_ZUSCHLAG,
};

export type FreshnessReport = Record<string, Freshness>;

export function freshnessReport(now: Date = new Date()): FreshnessReport {
  return Object.fromEntries(
    Object.entries(DATED_TABLES).map(([k, t]) => [k, freshness(t, now)]),
  );
}

/** Tables whose window has already closed. Non-empty means stale rates ship. */
export function expiredTables(now: Date = new Date()): string[] {
  return Object.entries(DATED_TABLES)
    .filter(([, t]) => freshness(t, now).status === "expired")
    .map(([k]) => k);
}
