/**
 * shared/eligibility.ts
 *
 * Qualification engine: decides whether a constellation meets the economic and
 * structural preconditions the calculator can observe.
 *
 * Deterministic and rule-based — no model, no inference, no invented facts.
 *
 * Hard rule: this never declares legal compliance. It reports economic and
 * structural preconditions in those words. REQUIRES_REVIEW means a human must
 * look at it.
 *
 * When a fact is unknown the engine names that fact and why it matters rather
 * than assuming a value for it.
 */

import { z } from "zod";
import type { MieterstromInputs, MieterstromKpis, PilotOfferCode } from "./schema.js";
import { PILOT_OFFER_FULFILLMENT } from "./pilot-order.js";
import { modelledByCalculator } from "./legal-models.js";
import { regimeWarning } from "./tariffs.js";

// ============================================================================
// VERDICT
// ============================================================================

export const ELIGIBILITY_VERDICTS = [
  "ELIGIBLE",
  "LIKELY_ELIGIBLE",
  "REQUIRES_REVIEW",
  "NOT_ELIGIBLE",
  "INSUFFICIENT_DATA",
] as const;

export const EligibilityVerdictSchema = z.enum(ELIGIBILITY_VERDICTS);
export type EligibilityVerdict = z.infer<typeof EligibilityVerdictSchema>;

export const VERDICT_LABEL_DE: Record<EligibilityVerdict, string> = {
  ELIGIBLE: "Voraussetzungen erfüllt",
  LIKELY_ELIGIBLE: "Voraussetzungen wahrscheinlich erfüllt",
  REQUIRES_REVIEW: "Prüfung erforderlich",
  NOT_ELIGIBLE: "Voraussetzungen nicht erfüllt",
  INSUFFICIENT_DATA: "Angaben unvollständig",
};

/**
 * Precedence, highest first. A known blocker beats a missing fact: if we can
 * already see the project cannot work as modelled, saying "incomplete" would
 * be a way of avoiding the answer.
 */
const VERDICT_RANK: Record<EligibilityVerdict, number> = {
  NOT_ELIGIBLE: 0,
  REQUIRES_REVIEW: 1,
  INSUFFICIENT_DATA: 2,
  LIKELY_ELIGIBLE: 3,
  ELIGIBLE: 4,
};

function worst(a: EligibilityVerdict, b: EligibilityVerdict): EligibilityVerdict {
  return VERDICT_RANK[a] <= VERDICT_RANK[b] ? a : b;
}

// ============================================================================
// QUALIFICATION FACTS — what the calculator cannot see
// ============================================================================

export const OwnerConstellationSchema = z.enum([
  "single_owner",
  "weg",
  "multiple_owners",
]);
export type OwnerConstellation = z.infer<typeof OwnerConstellationSchema>;

export const BuildingScopeSchema = z.enum([
  "single_building",
  "multiple_buildings_same_site",
  "across_grid",
]);
export type BuildingScope = z.infer<typeof BuildingScopeSchema>;

export const GenerationStatusSchema = z.enum(["existing", "planned", "none"]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const MeteringStatusSchema = z.enum(["ready", "planned", "unclear"]);
export type MeteringStatus = z.infer<typeof MeteringStatusSchema>;

/**
 * Every field optional. Unknown is a first-class state — the engine reports it
 * rather than defaulting to the answer that flatters the project.
 */
export const QualificationFactsSchema = z.object({
  ownerConstellation: OwnerConstellationSchema.optional(),
  buildingScope: BuildingScopeSchema.optional(),
  generationStatus: GenerationStatusSchema.optional(),
  metering: MeteringStatusSchema.optional(),
});
export type QualificationFacts = z.infer<typeof QualificationFactsSchema>;

export const FACT_LABEL_DE: Record<keyof QualificationFacts, string> = {
  ownerConstellation: "Eigentümerkonstellation",
  buildingScope: "Räumlicher Zuschnitt",
  generationStatus: "Status der Erzeugungsanlage",
  metering: "Mess- und Zählerkonzept",
};

/** Why each unknown fact actually matters. Not filler — this is the sales argument. */
export const FACT_WHY_DE: Record<keyof QualificationFacts, string> = {
  ownerConstellation:
    "Bestimmt, wer Betreiber und Lieferant sein kann und wie viele Zustimmungen nötig sind.",
  buildingScope:
    "Entscheidet, welches Beteiligungsmodell überhaupt in Frage kommt — der Rechner bildet nur eines davon ab.",
  generationStatus:
    "Bestandsanlagen und Neuanlagen unterscheiden sich in Vergütung, Fristen und Umbaubedarf.",
  metering:
    "Ohne belastbares Messkonzept ist die Abrechnung der entscheidende Umsetzungsengpass, nicht die Wirtschaftlichkeit.",
};

// ============================================================================
// FINDINGS
// ============================================================================

export const FindingSeveritySchema = z.enum(["blocker", "review", "info", "missing"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export type Finding = {
  code: string;
  severity: FindingSeverity;
  /** What we observed. Plain German, no legal conclusion. */
  message: string;
};

export type EligibilityInput = {
  economics: MieterstromInputs;
  kpis: MieterstromKpis;
  facts?: QualificationFacts;
};

export type NextPaidStep = {
  offerCode: PilotOfferCode;
  label: string;
  /** Why THIS tier, given THIS verdict. Never generic. */
  rationale: string;
};

export type EffortBand = "gering" | "mittel" | "hoch";

export type EligibilityResult = {
  verdict: EligibilityVerdict;
  verdictLabel: string;
  findings: Finding[];
  /** The named gaps. Drives both the UI and the paid-step rationale. */
  missingData: string[];
  feasibility: string;
  valueDriver: string;
  mainRisk: string;
  nextPaidStep: NextPaidStep | null;
  /** Scope of work, NOT a turnaround promise. */
  estimatedEffort: EffortBand;
};

// ============================================================================
// RULES
// ============================================================================

/** Below this the model's fixed costs make the constellation impractical. */
export const MIN_UNITS = 3;
/** Below this a rooftop constellation is not worth structuring. */
export const MIN_KWP = 5;

function economicFindings(input: EligibilityInput): Finding[] {
  const f: Finding[] = [];
  const { economics: e, kpis } = input;

  if (e.anzahlWohneinheiten < MIN_UNITS) {
    f.push({
      code: "units_below_threshold",
      severity: "blocker",
      message: `Mit ${e.anzahlWohneinheiten} Einheiten liegt die Konstellation unter der praktischen Schwelle von ${MIN_UNITS}. Der Aufwand für Lieferung, Messung und Abrechnung lässt sich auf so wenige Abnehmer nicht verteilen.`,
    });
  }

  if (e.kwp < MIN_KWP) {
    f.push({
      code: "kwp_below_threshold",
      severity: "blocker",
      message: `Mit ${e.kwp} kWp ist die Anlage zu klein, um die fixen Struktur- und Betriebskosten dieses Modells zu tragen.`,
    });
  }

  if (kpis.npvEur !== undefined && kpis.npvEur < 0) {
    f.push({
      code: "npv_negative",
      severity: "review",
      message:
        "Der Kapitalwert ist unter den aktuellen Annahmen negativ. Das schließt das Vorhaben nicht aus, verlangt aber eine belastbare Prüfung der Eingangswerte.",
    });
  }

  if (kpis.amortisationsdauerJahre === null && (kpis.npvEur ?? 0) < 0) {
    f.push({
      code: "no_amortisation",
      severity: "review",
      message:
        "Die Investition amortisiert sich im Betrachtungszeitraum nicht. Prüfen Sie zuerst Investitionskosten und Eigenverbrauchsquote.",
    });
  }

  if (e.eigenverbrauchsquote > 0.8) {
    f.push({
      code: "self_consumption_optimistic",
      severity: "review",
      message: `Eine Eigenverbrauchsquote von ${Math.round(e.eigenverbrauchsquote * 100)} % ist ohne Lastgang oder Speicher sehr optimistisch und trägt das Ergebnis überproportional.`,
    });
  }

  return f;
}

function factFindings(facts: QualificationFacts | undefined): Finding[] {
  const f: Finding[] = [];
  const s = facts ?? {};

  if (s.generationStatus === "none") {
    f.push({
      code: "no_generation",
      severity: "blocker",
      message:
        "Ohne vorhandene oder konkret geplante Erzeugungsanlage gibt es keine Konstellation, die strukturiert werden könnte.",
    });
  }

  if (s.buildingScope === "across_grid") {
    f.push({
      code: "scope_outside_model",
      severity: "review",
      message: `Ein standortübergreifender Zuschnitt fällt nicht unter das hier gerechnete Modell (${modelledByCalculator().name}). Welches Modell greift, ist fachlich zu prüfen.`,
    });
  }

  if (s.ownerConstellation === "weg") {
    f.push({
      code: "weg_consent",
      severity: "review",
      message:
        "Bei einer Eigentümergemeinschaft hängt die Umsetzbarkeit an Beschlussfassung und Zustimmungserfordernissen. Das ist regelmäßig der längste Pfad im Projekt.",
    });
  }

  if (s.ownerConstellation === "multiple_owners") {
    f.push({
      code: "multiple_owners",
      severity: "review",
      message:
        "Mehrere Eigentümer bedeuten mehrere Vertragsverhältnisse und eine gesonderte Klärung von Betreiber- und Lieferantenrolle.",
    });
  }

  // The 20-year model assumes a fixed feed-in tariff for the whole term, and
  // that regime is being withdrawn for new plants. A plant that is only planned
  // will almost certainly be commissioned after the change, so the projection
  // it is about to produce is structurally optimistic on the feed-in side.
  if (s.generationStatus === "planned") {
    const w = regimeWarning();
    // "info", not "review": this applies to EVERY planned plant, so escalating
    // the verdict on it would make REQUIRES_REVIEW meaningless. It is a caveat
    // about model accuracy, not a question about whether the project can go
    // ahead — and it surfaces as the main risk instead.
    f.push({
      code: "feed_in_regime_change",
      severity: "info",
      message: `${w.headline}. ${w.detail}`,
    });
  }

  if (s.metering === "unclear") {
    f.push({
      code: "metering_unclear",
      severity: "review",
      message:
        "Ein ungeklärtes Messkonzept ist in der Praxis der häufigste Grund, warum wirtschaftlich gerechnete Vorhaben nicht in Betrieb gehen.",
    });
  }

  return f;
}

function missingFactFindings(facts: QualificationFacts | undefined): {
  findings: Finding[];
  missing: string[];
} {
  const s = facts ?? {};
  const keys = Object.keys(FACT_LABEL_DE) as (keyof QualificationFacts)[];
  const unknown = keys.filter((k) => s[k] === undefined);

  return {
    findings: unknown.map((k) => ({
      code: `missing_${k}`,
      severity: "missing" as const,
      message: `${FACT_LABEL_DE[k]} ist nicht angegeben. ${FACT_WHY_DE[k]}`,
    })),
    missing: unknown.map((k) => FACT_LABEL_DE[k]),
  };
}

// ============================================================================
// THE ENGINE
// ============================================================================

/** How many unknown facts before the picture is genuinely not assessable. */
export const INSUFFICIENT_DATA_THRESHOLD = 2;

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const findings = [...economicFindings(input), ...factFindings(input.facts)];
  const { findings: missingFindings, missing } = missingFactFindings(input.facts);
  const allFindings = [...findings, ...missingFindings];

  const hasBlocker = findings.some((f) => f.severity === "blocker");
  const hasReview = findings.some((f) => f.severity === "review");

  let verdict: EligibilityVerdict = "ELIGIBLE";
  if (missing.length > 0) {
    verdict = worst(
      verdict,
      missing.length >= INSUFFICIENT_DATA_THRESHOLD ? "INSUFFICIENT_DATA" : "LIKELY_ELIGIBLE",
    );
  }
  if (hasReview) verdict = worst(verdict, "REQUIRES_REVIEW");
  if (hasBlocker) verdict = worst(verdict, "NOT_ELIGIBLE");

  return {
    verdict,
    verdictLabel: VERDICT_LABEL_DE[verdict],
    findings: allFindings,
    missingData: missing,
    feasibility: feasibilityLine(verdict, input),
    valueDriver: valueDriverLine(input),
    mainRisk: mainRiskLine(allFindings, input),
    nextPaidStep: nextPaidStep(verdict, input),
    estimatedEffort: effortBand(verdict, input),
  };
}

// ----------------------------------------------------------------------------
// The six lines the brief demands after every result.
// "Contact us" is not one of them.
// ----------------------------------------------------------------------------

function feasibilityLine(verdict: EligibilityVerdict, input: EligibilityInput): string {
  const model = modelledByCalculator().name;
  switch (verdict) {
    case "NOT_ELIGIBLE":
      return `Als ${model}-Konstellation in dieser Form nicht tragfähig. Die wirtschaftlichen und strukturellen Voraussetzungen sind nicht erfüllt.`;
    case "REQUIRES_REVIEW":
      return `Als ${model}-Konstellation grundsätzlich denkbar, aber mindestens ein Punkt muss fachlich geprüft werden, bevor Aufwand entsteht.`;
    case "INSUFFICIENT_DATA":
      return `Für eine belastbare Einordnung fehlen ${input.facts === undefined ? "alle" : "wesentliche"} Angaben zur Konstellation. Die Wirtschaftlichkeitsrechnung allein trägt die Entscheidung nicht.`;
    case "LIKELY_ELIGIBLE":
      return `Die geprüften Voraussetzungen sprechen für eine tragfähige ${model}-Konstellation; einzelne Angaben fehlen noch.`;
    case "ELIGIBLE":
      return `Die wirtschaftlichen und strukturellen Voraussetzungen einer ${model}-Konstellation sind nach den vorliegenden Angaben erfüllt.`;
  }
}

function valueDriverLine(input: EligibilityInput): string {
  const e = input.economics;
  // Ranked by how much each moves the result in this model, restricted to
  // levers the customer can actually act on.
  if (e.eigenverbrauchsquote < 0.4) {
    return `Eigenverbrauchsquote (${Math.round(e.eigenverbrauchsquote * 100)} %) — jeder zusätzliche Prozentpunkt vor Ort verbrauchter Strom trägt den Fall stärker als jede andere Stellschraube.`;
  }
  if (e.investitionEurPerKwp > 1600) {
    return `Investitionskosten (${Math.round(e.investitionEurPerKwp)} €/kWp) — ein belastbares Installateursangebot ist der schnellste Hebel auf das Ergebnis.`;
  }
  return `Eigenverbrauchsquote (${Math.round(e.eigenverbrauchsquote * 100)} %) im Zusammenspiel mit den Investitionskosten (${Math.round(e.investitionEurPerKwp)} €/kWp).`;
}

function mainRiskLine(findings: Finding[], input: EligibilityInput): string {
  const blocker = findings.find((f) => f.severity === "blocker");
  if (blocker) return blocker.message;
  const review = findings.find((f) => f.severity === "review");
  if (review) return review.message;
  const info = findings.find((f) => f.severity === "info");
  if (info) return info.message;
  if (input.economics.eigenverbrauchsquote > 0.6) {
    return "Die angenommene Eigenverbrauchsquote ist der empfindlichste Punkt: ohne Lastgang bleibt sie eine Schätzung, und sie trägt das Ergebnis.";
  }
  return "Das größte Restrisiko liegt in der Abweichung der angenommenen Werte von den tatsächlichen Projektdaten.";
}

const OFFER_LABEL: Record<PilotOfferCode, string> = {
  et_eligibility: "Pilot Eligibility Check",
  et_structuring: "Pilot Structuring Package",
  et_mandate: "Full Pilot Preparation Mandate",
};

function nextPaidStep(
  verdict: EligibilityVerdict,
  input: EligibilityInput,
): NextPaidStep | null {
  const facts = input.facts ?? {};

  // No paid step is offered when a blocker is already known.
  if (verdict === "NOT_ELIGIBLE") return null;

  if (verdict === "INSUFFICIENT_DATA" || verdict === "REQUIRES_REVIEW") {
    return {
      offerCode: "et_eligibility",
      label: OFFER_LABEL.et_eligibility,
      rationale:
        "Die offenen Punkte betreffen die Qualifizierung, nicht die Umsetzung. Der Eligibility Check klärt sie zum kleinsten Einsatz, bevor Strukturierungsaufwand entsteht.",
    };
  }

  const complex =
    facts.ownerConstellation === "weg" ||
    facts.ownerConstellation === "multiple_owners" ||
    facts.buildingScope === "multiple_buildings_same_site" ||
    input.economics.anzahlWohneinheiten >= 40;

  if (complex) {
    return {
      offerCode: "et_mandate",
      label: OFFER_LABEL.et_mandate,
      rationale:
        "Mehrere Beteiligte und Abstimmungsstufen verschieben den Engpass von der Rechnung zur Koordination. Das Mandat bereitet genau diese Abstimmung vor.",
    };
  }

  return {
    offerCode: "et_structuring",
    label: OFFER_LABEL.et_structuring,
    rationale:
      "Die Qualifizierung ist bereits geklärt. Der nächste echte Schritt ist die Strukturierung von Rollen, Verträgen und Datenlage.",
  };
}

function effortBand(verdict: EligibilityVerdict, input: EligibilityInput): EffortBand {
  if (verdict === "NOT_ELIGIBLE") return "gering";
  const facts = input.facts ?? {};
  const heavy =
    facts.ownerConstellation === "weg" ||
    facts.ownerConstellation === "multiple_owners" ||
    // Only a KNOWN multi-site scope raises effort. An unanswered question is
    // uncertainty, not complexity — treating absence as "not single building"
    // reported "hoch" for every visitor who answered nothing.
    (facts.buildingScope !== undefined && facts.buildingScope !== "single_building") ||
    input.economics.anzahlWohneinheiten >= 40;
  if (heavy) return "hoch";
  if (verdict === "REQUIRES_REVIEW" || verdict === "INSUFFICIENT_DATA") return "mittel";
  return "gering";
}

/**
 * The data the paid step will ask for, given what is already known. Reuses the
 * per-tier intake checklist so the calculator and the confirmation email never
 * ask for different things.
 */
export function intakeChecklistFor(step: NextPaidStep | null): string[] {
  return step ? PILOT_OFFER_FULFILLMENT[step.offerCode].requiredData : [];
}
