/**
 * shared/billing.ts
 *
 * Annual statement engine.
 *
 * The metering concept decides how a project can be built; the allocation
 * decides who gets which kilowatt-hour. This decides what each participant
 * actually pays — and unlike the other two, it has to be done again every
 * year, for every unit, for as long as the plant runs. It is the part of the
 * work that never ends, which is why it is worth automating properly.
 *
 * Money is handled in integer cents from end to end. Floating-point euros
 * drift, and a statement whose line items do not sum to its total is worthless
 * however good the physics behind it was. Every total here is the sum of the
 * items above it, computed as a sum rather than recomputed independently.
 *
 * The engine states amounts. It does not assert which items a statement is
 * required to contain, and it does not decide whether a tariff is permissible;
 * it reports a cap comparison when the reference tariff is supplied and
 * reports the comparison as undecidable when it is not.
 */

import { z } from "zod";
import { priceCapCheck } from "./tariffs.js";

// ============================================================================
// MONEY
// ============================================================================

/**
 * Round half away from zero, the convention German invoices use.
 *
 * JavaScript's Math.round rounds half UP, so it treats -0.5 and 0.5
 * asymmetrically — a credit and a charge of the same size would round by
 * different amounts.
 */
export function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function centsToEur(cents: number): number {
  return cents / 100;
}

export function formatEur(cents: number): string {
  return `${(cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

// ============================================================================
// INPUT
// ============================================================================

/** German standard VAT rate. Recorded with its own provenance, like every rate. */
export const VAT_STANDARD_RATE = 0.19;
export const VAT_SOURCE = {
  label: "Umsatzsteuer-Regelsatz",
  reference: null as string | null,
  asOf: null as string | null,
  verified: false,
};

/**
 * How the standing charge is spread over a part-year period.
 *
 * Stated rather than assumed silently: a different convention changes the
 * amount, so the result carries this string.
 */
export const PRORATION_CONVENTION_DE =
  "Der Grundpreis wird taggenau anteilig berechnet (Tage im Zeitraum / 365).";
const DAYS_PER_YEAR = 365;

export const TariffSchema = z.object({
  /** Working price for energy from the shared plant, ct/kWh net. */
  mieterstromCtPerKwh: z.number().min(0).max(200),
  /** Working price for the residual grid supply, ct/kWh net. */
  reststromCtPerKwh: z.number().min(0).max(200),
  /** Standing charge, EUR net per year. */
  grundpreisEurPerYear: z.number().min(0).max(10_000),
  /**
   * Local basic-supply working price, ct/kWh. Supplied, the engine reports the
   * cap comparison and the saving; omitted, it reports both as undecidable
   * rather than comparing against an invented reference.
   */
  grundversorgungCtPerKwh: z.number().min(0).max(200).optional(),
  /** Basic-supply standing charge, EUR net per year, for the same comparison. */
  grundversorgungGrundpreisEurPerYear: z.number().min(0).max(10_000).optional(),
});
export type Tariff = z.infer<typeof TariffSchema>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT erwartet.");

export const BillingPeriodSchema = z
  .object({ from: IsoDate, to: IsoDate })
  .refine((p) => p.from < p.to, { message: "Der Zeitraum muss mit dem Beginn anfangen." });
export type BillingPeriod = z.infer<typeof BillingPeriodSchema>;

export const BillingParticipantSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120).optional(),
  /** Energy taken from the shared plant in the period, kWh. */
  allocatedKwh: z.number().min(0).max(10_000_000),
  /** Energy taken from the grid in the period, kWh. */
  gridDrawKwh: z.number().min(0).max(10_000_000),
  /** Instalments already paid, EUR gross. */
  prepaidEur: z.number().min(0).max(1_000_000).optional(),
  /** Meter identifier, carried through to the statement when supplied. */
  meterNumber: z.string().max(64).optional(),
  /** Unit designation, carried through when supplied. */
  unitLabel: z.string().max(120).optional(),
});
export type BillingParticipant = z.infer<typeof BillingParticipantSchema>;

export const BillingInputSchema = z.object({
  period: BillingPeriodSchema,
  tariff: TariffSchema,
  participants: z.array(BillingParticipantSchema).min(1).max(2000),
  /** Defaults to the standard rate. */
  vatRate: z.number().min(0).max(1).optional(),
});
export type BillingInput = z.infer<typeof BillingInputSchema>;

// ============================================================================
// OUTPUT
// ============================================================================

export type StatementLine = {
  code: string;
  label: string;
  /** kWh, or days for the standing charge. */
  quantity: number;
  unit: string;
  /** ct/kWh, or ct/day. */
  unitPriceCt: number;
  /** Net amount in cents. The statement total is the sum of these. */
  netCents: number;
};

export type ParticipantStatement = {
  id: string;
  label: string | null;
  unitLabel: string | null;
  meterNumber: string | null;
  lines: StatementLine[];
  netCents: number;
  vatCents: number;
  grossCents: number;
  prepaidCents: number;
  /** Positive: still owed. Negative: to be refunded. */
  balanceCents: number;
  consumptionKwh: number;
  /** Share of consumption covered by the shared plant. Null if nothing used. */
  sharedShare: number | null;
  /**
   * Gross difference against full basic supply for the same consumption.
   * Positive means cheaper. Null when the reference tariff was not supplied.
   */
  savingVsGrundversorgungCents: number | null;
};

export type BillingTotals = {
  participants: number;
  allocatedKwh: number;
  gridDrawKwh: number;
  consumptionKwh: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
  prepaidCents: number;
  balanceCents: number;
  savingVsGrundversorgungCents: number | null;
};

export type BillingResult = {
  period: BillingPeriod;
  days: number;
  vatRate: number;
  statements: ParticipantStatement[];
  totals: BillingTotals;
  /** Cap comparison for the tenant working price, or an explicit unknown. */
  priceCap: { status: "ok" | "over_cap" | "unknown"; capCtPerKwh: number | null };
  /** Fields absent from the input that a statement would normally carry. */
  missingData: string[];
  warnings: { code: string; message: string }[];
  conventions: string[];
  disclaimer: string;
};

export const BILLING_DISCLAIMER_DE =
  "Rechnerische Abrechnung auf Basis der übergebenen Mengen und Preise. Sie ersetzt weder die Rechnungsstellung des Lieferanten noch deren fachliche Prüfung.";

// ============================================================================
// ENGINE
// ============================================================================

export class BillingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BillingError";
    this.code = code;
  }
}

const MS_PER_DAY = 86_400_000;

/** Inclusive of the start date, exclusive of the end date. */
export function daysInPeriod(period: BillingPeriod): number {
  const from = Date.parse(`${period.from}T00:00:00Z`);
  const to = Date.parse(`${period.to}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new BillingError("invalid_period", "Der Abrechnungszeitraum ist kein gültiges Datum.");
  }
  return Math.round((to - from) / MS_PER_DAY);
}

/** Net cents for an energy quantity at a ct/kWh price. */
function energyCents(kwh: number, ctPerKwh: number): number {
  return roundCents(kwh * ctPerKwh);
}

/** Net cents of the standing charge for the period, prorated by day. */
function standingChargeCents(grundpreisEurPerYear: number, days: number): number {
  return roundCents((grundpreisEurPerYear * 100 * days) / DAYS_PER_YEAR);
}

function statementFor(
  p: BillingParticipant,
  tariff: Tariff,
  days: number,
  vatRate: number,
): ParticipantStatement {
  const lines: StatementLine[] = [];

  if (p.allocatedKwh > 0) {
    lines.push({
      code: "mieterstrom",
      label: "Strom aus der Gemeinschaftsanlage",
      quantity: p.allocatedKwh,
      unit: "kWh",
      unitPriceCt: tariff.mieterstromCtPerKwh,
      netCents: energyCents(p.allocatedKwh, tariff.mieterstromCtPerKwh),
    });
  }

  if (p.gridDrawKwh > 0) {
    lines.push({
      code: "reststrom",
      label: "Reststrombezug aus dem Netz",
      quantity: p.gridDrawKwh,
      unit: "kWh",
      unitPriceCt: tariff.reststromCtPerKwh,
      netCents: energyCents(p.gridDrawKwh, tariff.reststromCtPerKwh),
    });
  }

  const standing = standingChargeCents(tariff.grundpreisEurPerYear, days);
  if (standing !== 0) {
    lines.push({
      code: "grundpreis",
      label: "Grundpreis",
      quantity: days,
      unit: "Tage",
      // Reported at day resolution so the line reconciles with its own amount.
      unitPriceCt: days > 0 ? Math.round((standing / days) * 100) / 100 : 0,
      netCents: standing,
    });
  }

  // The total IS the sum of the lines. Recomputing it independently is how a
  // statement ends up disagreeing with itself by a cent.
  const netCents = lines.reduce((s, l) => s + l.netCents, 0);
  const vatCents = roundCents(netCents * vatRate);
  const grossCents = netCents + vatCents;
  const prepaidCents = roundCents((p.prepaidEur ?? 0) * 100);

  const consumptionKwh = p.allocatedKwh + p.gridDrawKwh;

  let savingVsGrundversorgungCents: number | null = null;
  if (tariff.grundversorgungCtPerKwh !== undefined) {
    const refEnergy = energyCents(consumptionKwh, tariff.grundversorgungCtPerKwh);
    const refStanding = standingChargeCents(
      tariff.grundversorgungGrundpreisEurPerYear ?? tariff.grundpreisEurPerYear,
      days,
    );
    const refNet = refEnergy + refStanding;
    const refGross = refNet + roundCents(refNet * vatRate);
    savingVsGrundversorgungCents = refGross - grossCents;
  }

  return {
    id: p.id,
    label: p.label ?? null,
    unitLabel: p.unitLabel ?? null,
    meterNumber: p.meterNumber ?? null,
    lines,
    netCents,
    vatCents,
    grossCents,
    prepaidCents,
    balanceCents: grossCents - prepaidCents,
    consumptionKwh,
    sharedShare: consumptionKwh > 0 ? p.allocatedKwh / consumptionKwh : null,
    savingVsGrundversorgungCents,
  };
}

const OPTIONAL_FIELD_LABELS: { key: string; label: string }[] = [
  { key: "meterNumber", label: "Zählernummer je Teilnehmer" },
  { key: "unitLabel", label: "Bezeichnung der Einheit" },
  { key: "prepaidEur", label: "Geleistete Abschlagszahlungen" },
];

/**
 * Produce the statements for one period.
 *
 * Deterministic and exact: every total is a sum of the amounts above it, so
 * the statements reconcile to the period total with no residual.
 */
export function billPeriod(input: BillingInput): BillingResult {
  const days = daysInPeriod(input.period);
  if (days <= 0) {
    throw new BillingError("empty_period", "Der Abrechnungszeitraum umfasst keine Tage.");
  }

  const ids = new Set<string>();
  for (const p of input.participants) {
    if (ids.has(p.id)) {
      throw new BillingError("duplicate_participant", `Teilnehmer-ID "${p.id}" kommt mehrfach vor.`);
    }
    ids.add(p.id);
  }

  const vatRate = input.vatRate ?? VAT_STANDARD_RATE;
  const statements = input.participants.map((p) => statementFor(p, input.tariff, days, vatRate));

  const sum = (pick: (s: ParticipantStatement) => number) =>
    statements.reduce((acc, s) => acc + pick(s), 0);

  const savingsKnown = statements.every((s) => s.savingVsGrundversorgungCents !== null);

  const totals: BillingTotals = {
    participants: statements.length,
    allocatedKwh: input.participants.reduce((s, p) => s + p.allocatedKwh, 0),
    gridDrawKwh: input.participants.reduce((s, p) => s + p.gridDrawKwh, 0),
    consumptionKwh: sum((s) => s.consumptionKwh),
    netCents: sum((s) => s.netCents),
    vatCents: sum((s) => s.vatCents),
    grossCents: sum((s) => s.grossCents),
    prepaidCents: sum((s) => s.prepaidCents),
    balanceCents: sum((s) => s.balanceCents),
    savingVsGrundversorgungCents: savingsKnown
      ? sum((s) => s.savingVsGrundversorgungCents ?? 0)
      : null,
  };

  const missingData: string[] = [];
  for (const field of OPTIONAL_FIELD_LABELS) {
    const anyPresent = input.participants.some(
      (p) => (p as unknown as Record<string, unknown>)[field.key] !== undefined,
    );
    if (!anyPresent) missingData.push(field.label);
  }
  if (input.tariff.grundversorgungCtPerKwh === undefined) {
    missingData.push("Örtlicher Grundversorgungstarif");
  }

  const warnings: { code: string; message: string }[] = [];

  const cap = priceCapCheck(input.tariff.mieterstromCtPerKwh, input.tariff.grundversorgungCtPerKwh);
  if (cap.status === "over_cap" && cap.capCtPerKwh !== null) {
    warnings.push({
      code: "price_over_cap",
      message: `Der Arbeitspreis von ${input.tariff.mieterstromCtPerKwh.toLocaleString("de-DE")} ct/kWh liegt über dem Vergleichswert von ${cap.capCtPerKwh.toLocaleString("de-DE")} ct/kWh, der sich aus dem übergebenen Grundversorgungstarif ergibt.`,
    });
  }
  if (cap.status === "unknown") {
    warnings.push({
      code: "price_cap_unchecked",
      message:
        "Ohne den örtlichen Grundversorgungstarif lässt sich der Vergleichswert für den Arbeitspreis nicht bilden.",
    });
  }

  const noAllocation = statements.filter((s) => s.consumptionKwh > 0 && s.lines.every((l) => l.code !== "mieterstrom"));
  if (noAllocation.length > 0) {
    warnings.push({
      code: "participants_without_allocation",
      message: `${noAllocation.length} Teilnehmer haben im Zeitraum keinen Strom aus der Anlage bezogen und werden vollständig über den Reststrom abgerechnet.`,
    });
  }

  const refunds = statements.filter((s) => s.balanceCents < 0).length;
  if (refunds > 0) {
    warnings.push({
      code: "refunds_due",
      message: `${refunds} Teilnehmer haben ein Guthaben aus zu hohen Abschlägen.`,
    });
  }

  if (!VAT_SOURCE.verified) {
    warnings.push({
      code: "vat_rate_unverified",
      message: `Der angesetzte Umsatzsteuersatz von ${(vatRate * 100).toLocaleString("de-DE")} % ist nicht gegen eine benannte Quelle geprüft und projektspezifisch zu bestätigen.`,
    });
  }

  return {
    period: input.period,
    days,
    vatRate,
    statements,
    totals,
    priceCap: cap,
    missingData,
    warnings,
    conventions: [PRORATION_CONVENTION_DE],
    disclaimer: BILLING_DISCLAIMER_DE,
  };
}

/**
 * Independent reconciliation of a result.
 *
 * Recomputes the identities the engine is supposed to guarantee, from the
 * output alone. It exists so a caller — or a test — can assert the statement
 * adds up without trusting the code that produced it.
 */
export function reconcile(result: BillingResult): {
  ok: boolean;
  failures: { code: string; detail: string }[];
} {
  const failures: { code: string; detail: string }[] = [];

  for (const s of result.statements) {
    const lineSum = s.lines.reduce((acc, l) => acc + l.netCents, 0);
    if (lineSum !== s.netCents) {
      failures.push({
        code: "statement_lines_do_not_sum",
        detail: `${s.id}: Positionen ${lineSum}, ausgewiesen ${s.netCents}`,
      });
    }
    if (s.netCents + s.vatCents !== s.grossCents) {
      failures.push({ code: "gross_mismatch", detail: `${s.id}` });
    }
    if (s.grossCents - s.prepaidCents !== s.balanceCents) {
      failures.push({ code: "balance_mismatch", detail: `${s.id}` });
    }
  }

  const sum = (pick: (s: ParticipantStatement) => number) =>
    result.statements.reduce((acc, s) => acc + pick(s), 0);

  if (sum((s) => s.netCents) !== result.totals.netCents) {
    failures.push({ code: "totals_net_mismatch", detail: "Summe der Teilnehmer" });
  }
  if (sum((s) => s.grossCents) !== result.totals.grossCents) {
    failures.push({ code: "totals_gross_mismatch", detail: "Summe der Teilnehmer" });
  }

  return { ok: failures.length === 0, failures };
}
