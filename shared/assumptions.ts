/**
 * shared/assumptions.ts
 *
 * PROVENANCE AND VERSIONING FOR EVERY NUMBER THE PRODUCT SELLS.
 *
 * The calculator is the wedge, and the PDF is the artefact a customer forwards
 * to an owner, a bank or a Stadtwerk. Before this file, that PDF presented
 * twelve default inputs, a CO2 factor and a "6–10 % IRR" benchmark with no
 * indication that most of them are unsourced starting values — and with no
 * version stamp, so two reports produced months apart under different defaults
 * were indistinguishable.
 *
 * Selling an unsourced number as a fact is the fastest way to lose a
 * professional buyer. This module makes provenance explicit and machine-
 * readable, so the report can state it rather than imply authority it lacks.
 *
 * The math is untouched. This is metadata about the math.
 *
 * INVARIANT (enforced by assumptions.test.ts):
 *   verified === true  ⇒  reference !== null AND asOf !== null
 * You cannot mark something verified without saying where it came from and as
 * of when. Today every entry is verified:false, which is the honest state.
 */

// ============================================================================
// SOURCE OF TRUTH
// ============================================================================

export const SOURCE_OF_TRUTH = [
  /** Law, regulator publication, official statistic. Requires a citation. */
  "OFFICIAL_SOURCE",
  /** Supplied by the customer for this specific project. */
  "CUSTOMER_PROVIDED",
  /** Our own engineering judgement. Defensible, not authoritative. */
  "ENGINEERING_ESTIMATE",
  /** Observed market pricing / tariffs. Requires a citation and a date. */
  "MARKET_DATA",
  /** Measured history for this or a comparable asset. */
  "HISTORICAL_DATA",
  /** A stand-in. Not to be presented as a fact under any circumstance. */
  "PLACEHOLDER",
] as const;

export type SourceOfTruth = (typeof SOURCE_OF_TRUTH)[number];

/** Short German labels for the report. */
export const SOURCE_LABEL_DE: Record<SourceOfTruth, string> = {
  OFFICIAL_SOURCE: "Amtliche Quelle",
  CUSTOMER_PROVIDED: "Kundenangabe",
  ENGINEERING_ESTIMATE: "Fachliche Schätzung",
  MARKET_DATA: "Marktdaten",
  HISTORICAL_DATA: "Historische Daten",
  PLACEHOLDER: "Platzhalter",
};

export type AssumptionMeta = {
  label: string;
  unit: string;
  source: SourceOfTruth;
  /**
   * Where the value comes from. MUST be non-null when verified is true.
   * null means: nobody has sourced this yet.
   */
  reference: string | null;
  /** ISO date the reference was checked. MUST be non-null when verified. */
  asOf: string | null;
  /**
   * Has a human checked this value against its reference?
   * Everything ships false until someone actually does the work.
   */
  verified: boolean;
  /** Caveats a reader of the report deserves to see. */
  note?: string;
};

/** A value is safe to present as fact only if it is verified and not a placeholder. */
export function isPresentableAsFact(meta: AssumptionMeta): boolean {
  return meta.verified && meta.source !== "PLACEHOLDER";
}

// ============================================================================
// VERSIONING — every output must be reproducible
// ============================================================================

/** Bump on ANY change to the calculation itself (mieterstrom.ts / sensitivity.ts). */
export const MODEL_VERSION = "1.0.0";

/** Bump whenever a default value or its provenance changes. */
export const ASSUMPTION_SET = "de-mieterstrom-2026-09";

export const JURISDICTION = "DE" as const;
export const CURRENCY = "EUR" as const;

export type CalculationStamp = {
  modelVersion: string;
  assumptionSet: string;
  /** ISO-8601. When this specific output was produced. */
  calculationDate: string;
  jurisdiction: typeof JURISDICTION;
  currency: typeof CURRENCY;
  /** Which scenario the narrative in the output refers to. */
  scenario: string;
};

export function buildCalculationStamp(
  scenario: string,
  now: Date = new Date(),
): CalculationStamp {
  return {
    modelVersion: MODEL_VERSION,
    assumptionSet: ASSUMPTION_SET,
    calculationDate: now.toISOString(),
    jurisdiction: JURISDICTION,
    currency: CURRENCY,
    scenario,
  };
}

/** One-line stamp for a report footer. Deterministic given the stamp. */
export function formatStampLine(stamp: CalculationStamp): string {
  const date = stamp.calculationDate.slice(0, 10);
  return [
    `Modell ${stamp.modelVersion}`,
    `Annahmensatz ${stamp.assumptionSet}`,
    `${stamp.jurisdiction} · ${stamp.currency}`,
    `Szenario ${stamp.scenario}`,
    `berechnet ${date}`,
  ].join(" · ");
}

// ============================================================================
// THE ASSUMPTION REGISTER
// ============================================================================

export type MieterstromAssumptionKey =
  | "kwp"
  | "anzahlWohneinheiten"
  | "eigenverbrauchsquote"
  | "strompreisMieterCtPerKwh"
  | "mieterstromZuschlagCtPerKwh"
  | "einspeiseverguetungCtPerKwh"
  | "investitionEurPerKwp"
  | "betriebskostenEurPerKwpJahr"
  | "laufzeitJahre"
  | "diskontierungssatz"
  | "degradationPctPerJahr"
  | "spezifischerErtragKwhPerKwp";

export const MIETERSTROM_ASSUMPTIONS: Record<MieterstromAssumptionKey, AssumptionMeta> = {
  kwp: {
    label: "Anlagengröße",
    unit: "kWp",
    source: "PLACEHOLDER",
    reference: null,
    asOf: null,
    verified: false,
    note: "Illustrativer Startwert des Rechners. Ohne Dachbelegungsprüfung ohne Aussagekraft.",
  },
  anzahlWohneinheiten: {
    label: "Wohneinheiten",
    unit: "Stück",
    source: "PLACEHOLDER",
    reference: null,
    asOf: null,
    verified: false,
    note: "Illustrativer Startwert des Rechners.",
  },
  eigenverbrauchsquote: {
    label: "Eigenverbrauchsquote",
    unit: "%",
    source: "ENGINEERING_ESTIMATE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Ohne Lastgang nicht belastbar. Sie ist zugleich der stärkste Ergebnistreiber — Abweichungen schlagen voll auf IRR und NPV durch.",
  },
  strompreisMieterCtPerKwh: {
    label: "Strompreis Mieter",
    unit: "ct/kWh",
    source: "MARKET_DATA",
    reference: null,
    asOf: null,
    verified: false,
    note: "Der Mieterstrompreis ist gesetzlich nach oben begrenzt (Anteil des örtlichen Grundversorgungstarifs). Diese Obergrenze ist im Modell NICHT abgebildet und projektspezifisch zu prüfen.",
  },
  mieterstromZuschlagCtPerKwh: {
    label: "Mieterstromzuschlag",
    unit: "ct/kWh",
    source: "OFFICIAL_SOURCE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Gesetzlich geregelter, degressiver Zuschlag. Der hinterlegte Wert ist NICHT gegen die aktuelle amtliche Veröffentlichung verifiziert und vor jeder Verwendung zu prüfen.",
  },
  einspeiseverguetungCtPerKwh: {
    label: "Einspeisevergütung",
    unit: "ct/kWh",
    source: "OFFICIAL_SOURCE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Abhängig von Anlagengröße und Inbetriebnahmedatum, degressiv. Der hinterlegte Wert ist NICHT gegen die aktuelle amtliche Veröffentlichung verifiziert.",
  },
  investitionEurPerKwp: {
    label: "Investition",
    unit: "€/kWp",
    source: "MARKET_DATA",
    reference: null,
    asOf: null,
    verified: false,
    note: "Ohne Angebot eines Installateurs ein Richtwert. Enthält keine Sonderkosten (Netzanschluss, Statik, Speicher, Zählerumbau).",
  },
  betriebskostenEurPerKwpJahr: {
    label: "Betriebskosten",
    unit: "€/kWp·a",
    source: "ENGINEERING_ESTIMATE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Enthält keine Messstellenbetriebs-, Abrechnungs- oder Lieferantenkosten des Mieterstrommodells.",
  },
  laufzeitJahre: {
    label: "Betrachtungszeitraum",
    unit: "Jahre",
    source: "ENGINEERING_ESTIMATE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Modellkonvention, kein Anlagenlebensdauer-Nachweis.",
  },
  diskontierungssatz: {
    label: "Diskontierungssatz",
    unit: "%",
    source: "ENGINEERING_ESTIMATE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Ist eine Kapitalkosten-Annahme des Betrachters, keine Projekteigenschaft.",
  },
  degradationPctPerJahr: {
    label: "Degradation",
    unit: "%/a",
    source: "ENGINEERING_ESTIMATE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Typische Modulgarantie-Größenordnung, herstellerabhängig.",
  },
  spezifischerErtragKwhPerKwp: {
    label: "Spezifischer Ertrag",
    unit: "kWh/kWp·a",
    source: "ENGINEERING_ESTIMATE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Stark standort-, ausrichtungs- und verschattungsabhängig. Ersetzt keine Ertragsprognose.",
  },
};

// ----------------------------------------------------------------------------
// Constants the engine applies WITHOUT exposing them as inputs.
// These were previously invisible: they shaped every result and appeared
// nowhere in the UI or the report. Declaring them is the whole point.
// ----------------------------------------------------------------------------

export const IMPLICIT_ASSUMPTIONS: Record<string, AssumptionMeta & { value: string }> = {
  betriebskostenInflation: {
    label: "Kostensteigerung Betriebskosten",
    unit: "%/a",
    value: "2,0",
    source: "ENGINEERING_ESTIMATE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Fest im Modell hinterlegt und derzeit nicht im Rechner einstellbar.",
  },
  co2Faktor: {
    label: "CO2-Faktor Strommix",
    unit: "t/MWh",
    value: "0,38",
    source: "OFFICIAL_SOURCE",
    reference: null,
    asOf: null,
    verified: false,
    note: "Faktor für den deutschen Strommix; NICHT gegen die aktuelle amtliche Veröffentlichung verifiziert. Der Wert sinkt über die Zeit — die CO2-Einsparung ist daher tendenziell zu hoch ausgewiesen.",
  },
  benchmarkIrrBand: {
    label: "Benchmark-Bandbreite IRR",
    unit: "%",
    value: "6–10",
    source: "PLACEHOLDER",
    reference: null,
    asOf: null,
    verified: false,
    note: "Interner Orientierungswert ohne belegte Datengrundlage. Nicht als Marktbenchmark zu zitieren.",
  },
};

/**
 * The IRR band the interpretation text compares against. Single source of
 * truth shared by interpret.ts and the report, so the prose and the
 * provenance table can never drift apart.
 */
export const BENCHMARK_IRR_LOW = 6;
export const BENCHMARK_IRR_HIGH = 10;

// ============================================================================
// PER-VALUE PROVENANCE
// ============================================================================

/**
 * Provenance belongs to a VALUE, not to a field.
 *
 * The moment a customer edits an input it stops being our placeholder and
 * becomes their statement about their project — which is a materially
 * different claim. Resolving this per value is what lets the report say
 * "Kundenangabe" next to the six numbers the customer actually typed and
 * "Platzhalter" next to the ones they never touched.
 */
export function resolveSource(
  key: MieterstromAssumptionKey,
  value: number,
  defaults: Record<MieterstromAssumptionKey, number>,
): SourceOfTruth {
  const isUntouched = value === defaults[key];
  return isUntouched ? MIETERSTROM_ASSUMPTIONS[key].source : "CUSTOMER_PROVIDED";
}

export type ResolvedAssumption = {
  key: MieterstromAssumptionKey;
  label: string;
  unit: string;
  value: number;
  source: SourceOfTruth;
  sourceLabel: string;
  verified: boolean;
  note?: string;
};

export function resolveAssumptions(
  inputs: Record<MieterstromAssumptionKey, number>,
  defaults: Record<MieterstromAssumptionKey, number>,
): ResolvedAssumption[] {
  return (Object.keys(MIETERSTROM_ASSUMPTIONS) as MieterstromAssumptionKey[]).map((key) => {
    const meta = MIETERSTROM_ASSUMPTIONS[key];
    const source = resolveSource(key, inputs[key], defaults);
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      value: inputs[key],
      source,
      sourceLabel: SOURCE_LABEL_DE[source],
      // A customer-supplied value is theirs to stand behind; our unverified
      // default is not. Either way the report says which it is.
      verified: source === "CUSTOMER_PROVIDED" ? true : meta.verified,
      note: meta.note,
    };
  });
}

/**
 * The values in this specific report that must NOT be read as established
 * facts. Drives the warning block in the PDF.
 */
export function unverifiedAssumptions(resolved: ResolvedAssumption[]): ResolvedAssumption[] {
  return resolved.filter((r) => !r.verified || r.source === "PLACEHOLDER");
}
