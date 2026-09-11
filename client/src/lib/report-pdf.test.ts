import { describe, it, expect } from "vitest";
import { buildReportDoc, type ScenarioBundle } from "./report-pdf";
import { calculateMieterstrom, DEFAULTS } from "./mieterstrom";
import { ASSUMPTION_SET, MODEL_VERSION } from "../../../shared/assumptions";
import type { QualificationFacts } from "../../../shared/eligibility";
import type { MesskonzeptAnswers } from "./report-pdf";
import { contactEmail, legalEntityPublishable } from "../../../shared/legal-entity";

const QUALIFIED: QualificationFacts = {
  ownerConstellation: "single_owner",
  buildingScope: "single_building",
  generationStatus: "planned",
  metering: "ready",
};

const base = calculateMieterstrom(DEFAULTS);
const scenarios: ScenarioBundle = { konservativ: base, realistisch: base, optimistisch: base };

const FIXED_NOW = new Date("2026-09-06T10:00:00Z");

/**
 * jsPDF writes text uncompressed, so the rendered artefact can be searched
 * directly. These assertions therefore test the DOCUMENT THE CUSTOMER
 * RECEIVES, not just the functions that feed it.
 */
function renderText(
  inputs = DEFAULTS,
  now = FIXED_NOW,
  facts?: QualificationFacts,
  messkonzept?: MesskonzeptAnswers,
): string {
  const uri = buildReportDoc(inputs, scenarios, { now, facts, messkonzept }).output("datauristring");
  return Buffer.from(uri.split(",")[1], "base64").toString("latin1");
}

describe("buildReportDoc", () => {
  it("produces a valid non-empty PDF", () => {
    const bytes = new Uint8Array(
      buildReportDoc(DEFAULTS, scenarios, { now: FIXED_NOW }).output("arraybuffer"),
    );
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(bytes.length).toBeGreaterThan(2000);
  });

  // Every output must be reproducible from its stamp.
  it("stamps model version, assumption set, jurisdiction, currency and date", () => {
    const raw = renderText();
    expect(raw).toContain(MODEL_VERSION);
    expect(raw).toContain(ASSUMPTION_SET);
    expect(raw).toContain("2026-09-06");
    expect(raw).toMatch(/DE/);
    expect(raw).toMatch(/EUR/);
  });

  // The report names the operator exactly as the operator record does: the
  // record's mailbox, and no city the record does not state.
  it("takes the contact from the operator record and invents no location", () => {
    const raw = renderText();
    const email = contactEmail();
    if (email) expect(raw).toContain(email);
    if (!legalEntityPublishable()) expect(raw).not.toContain("Frankfurt");
  });

  // P0.4 — the report must not present placeholders as facts.
  it("carries a provenance section that names unsourced values as such", () => {
    const raw = renderText();
    expect(raw).toContain("Herkunft der Annahmen");
    expect(raw).toContain("Platzhalter");
    expect(raw).toContain("unbelegt");
    expect(raw).toContain("Nicht belegte Werte in diesem Bericht");
  });

  it("labels values the customer supplied as their own statement", () => {
    const edited = { ...DEFAULTS, kwp: 88, investitionEurPerKwp: 1210 };
    expect(renderText(edited)).toContain("Kundenangabe");
  });

  // P0.5 — this document gets forwarded to owners and banks.
  it("carries no personal mailbox", () => {
    const raw = renderText();
    expect(raw.toLowerCase()).not.toContain("gmail");
    expect(raw).toContain("energie-teilen.de");
  });

  // The metering section is derived, not asserted: without the connection
  // situation the report says so rather than printing a plausible concept.
  it("reports the metering concept as not determinable when nothing decides it", () => {
    const raw = renderText();
    expect(raw).toContain("Messkonzept und Umsetzungspfad");
    expect(raw).toContain("Nicht bestimmbar");
    expect(raw).not.toContain("Summenz");
  });

  it("renders the meter inventory once the connection situation is given", () => {
    const raw = renderText(DEFAULTS, FIXED_NOW, QUALIFIED, {
      gridConnection: "single_connection",
    });
    expect(raw).toContain("Summenz");
    expect(raw).toContain("Erzeugungsz");
    expect(raw).toContain("Kritischer Pfad");
  });

  it("keeps the network operator's approval as the last word", () => {
    for (const raw of [
      renderText(),
      renderText(DEFAULTS, FIXED_NOW, QUALIFIED, { gridConnection: "public_grid" }),
    ]) {
      expect(raw).toContain("Netzbetreiber");
      expect(raw).toContain("geblich");
    }
  });

  // P0.3 — the report must say which of the three models it computes.
  it("states the model it computes and names the two it does not", () => {
    const raw = renderText();
    expect(raw).toContain("MODELL"); // summary-box labels render uppercased
    expect(raw).toContain("nicht berechnet");
    expect(raw).toContain("Energy Sharing");
  });

  it("cites no statutory paragraph, because none has been verified", () => {
    expect(renderText()).not.toMatch(/EnWG/);
  });

  // jsPDF's built-in Helvetica is WinAnsi-encoded: U+2082 has no glyph, so
  // PDF-bound strings stay ASCII.
  it("renders no unmapped glyphs in the CO2 labels", () => {
    const raw = renderText();
    expect(raw).toContain("CO2-Einsparung");
    expect(raw).not.toContain("CO ,");
  });

  // P1 — the report must end in a decision, not a brochure.
  it("carries the eligibility verdict and the effort band", () => {
    const raw = renderText();
    // jsPDF writes WinAnsi bytes; latin1-decoding them gives back the umlauts.
    expect(raw).toContain("EINORDNUNG: ANGABEN UNVOLLST\u00c4NDIG");
    expect(raw).toContain("AUFWAND: MITTEL");
  });

  it("names a specific next paid step and what it needs", () => {
    const raw = renderText();
    expect(raw).toContain("Pilot Eligibility Check");
    expect(raw).toContain("Daf\u00fcr ben\u00f6tigen wir von Ihnen");
    expect(raw).toContain("Offene Angaben");
  });

  it("routes a fully qualified project to structuring instead", () => {
    const raw = renderText(DEFAULTS, FIXED_NOW, QUALIFIED);
    expect(raw).toContain("Pilot Structuring Package");
    expect(raw).not.toContain("Offene Angaben");
  });

  // No paid step is offered for a disqualified constellation.
  it("offers no paid step when the constellation is disqualified", () => {
    const raw = renderText({ ...DEFAULTS, anzahlWohneinheiten: 1 }, FIXED_NOW, QUALIFIED);
    expect(raw).not.toContain("Pilot Eligibility Check");
    expect(raw).not.toContain("Pilot Structuring Package");
    expect(raw).toContain("keinen bezahlten Schritt");
  });

  it("never falls back to a generic contact prompt", () => {
    for (const raw of [renderText(), renderText(DEFAULTS, FIXED_NOW, QUALIFIED)]) {
      expect(raw).not.toMatch(/Kontaktieren Sie uns|Nehmen Sie Kontakt/i);
    }
  });

  // Layout regression guard.
  it("stays at three pages, so nothing spills into a half-empty page", () => {
    expect(buildReportDoc(DEFAULTS, scenarios, { now: FIXED_NOW }).getNumberOfPages()).toBe(3);
  });

  it("stays within four pages with the full metering section rendered", () => {
    const pages = buildReportDoc(DEFAULTS, scenarios, {
      now: FIXED_NOW,
      facts: QUALIFIED,
      messkonzept: { gridConnection: "single_connection", storage: "planned", commercialUnits: 2 },
    }).getNumberOfPages();
    expect(pages).toBeLessThanOrEqual(4);
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it("is byte-identical for the same inputs and the same clock", () => {
    expect(renderText().length).toBe(renderText().length);
  });
});
