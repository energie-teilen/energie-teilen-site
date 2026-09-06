/**
 * shared/legal-models.ts
 *
 * THE THREE MODELS, SEPARATED — AND THE GATE THAT KEEPS UNVERIFIED
 * STATUTORY CITATIONS OUT OF THE PRODUCT.
 *
 * The site was asserting "Mieterstrom nach §42b EnWG" in seven places,
 * including Schema.org FAQ markup that search engines surface as a rich
 * result. Mieterstrom, gemeinschaftliche Gebäudeversorgung and Energy Sharing
 * are three different models with three different scopes, and the product was
 * collapsing them into one paragraph number while the brand talked about a
 * fourth thing. Meanwhile the calculator models exactly ONE of them.
 *
 * Two rules this file enforces:
 *
 *   1. A statutory citation is rendered ONLY if a human has verified it.
 *      formatCitation() returns null for every unverified entry, so an
 *      unchecked paragraph number is structurally unable to reach a user.
 *      Today all three are unverified, so the product cites no paragraph at
 *      all — which is correct, because nobody has checked them.
 *
 *   2. No paragraph number may be hard-coded anywhere else. legal-models.test.ts
 *      scans the source tree (index.html included) and fails the build if one
 *      appears outside this file and the legal pages.
 *
 * The `paragraph` fields below record what the team BELIEVES applies, so
 * counsel has one file to review rather than a grep. Verifying a model is a
 * two-field change — reference + asOf — and flipping `verified` turns the
 * citation on everywhere at once.
 *
 * NONE OF THE THREE HAS BEEN VERIFIED BY COUNSEL.
 */

export type LegalModelId = "mieterstrom" | "gebaeudeversorgung" | "energy_sharing";

export type StatutoryCitation = {
  /** e.g. "§ 42a". Believed, not established, until verified is true. */
  paragraph: string;
  /** e.g. "EnWG". */
  act: string;
  /**
   * Has a qualified person checked this citation against the current text of
   * the law? Until this is true the citation is never rendered.
   */
  verified: boolean;
  /** Where it was checked. MUST be non-null when verified is true. */
  reference: string | null;
  /** ISO date it was checked. MUST be non-null when verified is true. */
  asOf: string | null;
  /** What specifically still needs checking. */
  openQuestion?: string;
};

export type LegalModel = {
  id: LegalModelId;
  name: string;
  shortName: string;
  /**
   * Functional description. Deliberately contains NO statutory scope claim —
   * it says what people mean by the term, not what the law permits.
   */
  summary: string;
  /** Operational scope, in plain terms. Not a legal boundary. */
  scope: string;
  citation: StatutoryCitation | null;
  /** Does the deterministic engine actually compute this model today? */
  modelledByCalculator: boolean;
};

export const LEGAL_MODELS: Record<LegalModelId, LegalModel> = {
  mieterstrom: {
    id: "mieterstrom",
    name: "Mieterstrom",
    shortName: "Mieterstrom",
    summary:
      "Direkte Belieferung von Letztverbrauchern in einem Gebäude mit Strom aus einer Erzeugungsanlage vor Ort, typischerweise Photovoltaik.",
    scope: "Innerhalb eines Gebäudes oder einer zusammenhängenden Liegenschaft.",
    citation: {
      paragraph: "§ 42a",
      act: "EnWG",
      verified: false,
      reference: null,
      asOf: null,
      openQuestion:
        "Paragraf und aktuelle Fassung sind nicht geprüft. Zusätzlich zu klären: Verhältnis zum Mieterstromzuschlag im EEG und zur Preisobergrenze.",
    },
    // This is the one the engine computes.
    modelledByCalculator: true,
  },
  gebaeudeversorgung: {
    id: "gebaeudeversorgung",
    name: "Gemeinschaftliche Gebäudeversorgung",
    shortName: "Gebäudeversorgung",
    summary:
      "Gemeinsame Nutzung von Strom aus einer Anlage durch mehrere Letztverbraucher innerhalb desselben Gebäudes, mit anderer vertraglicher Ausgestaltung als Mieterstrom.",
    scope: "Innerhalb desselben Gebäudes.",
    citation: {
      paragraph: "§ 42b",
      act: "EnWG",
      verified: false,
      reference: null,
      asOf: null,
      openQuestion:
        "Paragraf und aktuelle Fassung sind nicht geprüft. Ebenso ungeprüft: die bisher auf der Seite behauptete Vereinfachung durch das Solarspitzengesetz.",
    },
    modelledByCalculator: false,
  },
  energy_sharing: {
    id: "energy_sharing",
    name: "Energy Sharing",
    shortName: "Energy Sharing",
    summary:
      "Teilen von erzeugtem Strom zwischen mehreren Beteiligten, die nicht im selben Gebäude sitzen.",
    scope: "Über mehrere Standorte hinweg unter Nutzung des öffentlichen Netzes.",
    citation: {
      paragraph: "§ 42c",
      act: "EnWG",
      verified: false,
      reference: null,
      asOf: null,
      openQuestion:
        "Paragraf, Inkrafttreten, räumlicher Anwendungsbereich und Messanforderungen sind nicht geprüft. Die Marke trägt diesen Namen — die Produktaussagen dürfen ihm nicht vorauseilen.",
    },
    modelledByCalculator: false,
  },
};

export const LEGAL_MODEL_ORDER: LegalModelId[] = [
  "mieterstrom",
  "gebaeudeversorgung",
  "energy_sharing",
];

/**
 * THE GATE.
 *
 * Returns a renderable citation string, or null when nobody has verified it.
 * Every call site must handle null by omitting the citation entirely — never
 * by falling back to the raw paragraph.
 */
export function formatCitation(model: LegalModel): string | null {
  const c = model.citation;
  if (!c || !c.verified) return null;
  if (!c.reference || !c.asOf) return null; // belt and braces; the test enforces this too
  return `${c.paragraph} ${c.act}`;
}

/** Model name with its citation appended only when the citation is verified. */
export function modelLabel(model: LegalModel): string {
  const citation = formatCitation(model);
  return citation ? `${model.name} (${citation})` : model.name;
}

/** The model the deterministic engine actually computes. */
export function modelledByCalculator(): LegalModel {
  const found = LEGAL_MODEL_ORDER.map((id) => LEGAL_MODELS[id]).filter(
    (m) => m.modelledByCalculator,
  );
  if (found.length !== 1) {
    throw new Error(
      `Exactly one model must be marked modelledByCalculator, found ${found.length}.`,
    );
  }
  return found[0];
}

/** Compact form for a summary box or a UI caption. */
export function calculatorCoverageShort(): string {
  const modelled = modelledByCalculator();
  const others = LEGAL_MODEL_ORDER.map((id) => LEGAL_MODELS[id])
    .filter((m) => !m.modelledByCalculator)
    .map((m) => m.name);
  return `${modelled.name}. ${others.join(" und ")} werden nicht berechnet.`;
}

/**
 * The sentence the report and the UI use to state what the calculation covers
 * and, just as importantly, what it does not. Generated rather than written by
 * hand so it cannot drift from the register.
 */
export function calculatorCoverageStatement(): string {
  const modelled = modelledByCalculator();
  const others = LEGAL_MODEL_ORDER.map((id) => LEGAL_MODELS[id])
    .filter((m) => !m.modelledByCalculator)
    .map((m) => m.name);
  return (
    `Diese Berechnung bildet ausschließlich eine ${modelled.name}-Konstellation ab. ` +
    `${others.join(" und ")} werden nicht berechnet. ` +
    `Welches Modell für Ihr Vorhaben zulässig oder vorteilhaft ist, ist projektspezifisch und fachlich zu prüfen.`
  );
}
