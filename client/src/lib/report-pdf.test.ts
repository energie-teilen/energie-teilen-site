import { describe, it, expect } from "vitest";
import { buildReportDoc, type ScenarioBundle } from "./report-pdf";
import { calculateMieterstrom, DEFAULTS } from "./mieterstrom";
import { ASSUMPTION_SET, MODEL_VERSION } from "../../../shared/assumptions";

const base = calculateMieterstrom(DEFAULTS);
const scenarios: ScenarioBundle = { konservativ: base, realistisch: base, optimistisch: base };

const FIXED_NOW = new Date("2026-09-06T10:00:00Z");

/**
 * jsPDF writes text uncompressed, so the rendered artefact can be searched
 * directly. These assertions therefore test the DOCUMENT THE CUSTOMER
 * RECEIVES, not just the functions that feed it.
 */
function renderText(inputs = DEFAULTS, now = FIXED_NOW): string {
  const uri = buildReportDoc(inputs, scenarios, { now }).output("datauristring");
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

  // P0.6 — a result nobody can reproduce is a result nobody can rely on.
  it("stamps model version, assumption set, jurisdiction, currency and date", () => {
    const raw = renderText();
    expect(raw).toContain(MODEL_VERSION);
    expect(raw).toContain(ASSUMPTION_SET);
    expect(raw).toContain("2026-09-06");
    expect(raw).toMatch(/DE/);
    expect(raw).toMatch(/EUR/);
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

  // The report used to promise a "Messkonzept-Skizze" it never contained.
  // It must not claim a deliverable it does not produce.
  it("does not claim to contain a Messkonzept it never renders", () => {
    expect(renderText()).not.toContain("Messkonzept");
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

  // jsPDF's built-in Helvetica is WinAnsi-encoded: U+2082 has no glyph and
  // "CO₂" silently rendered as "CO ,". Keep PDF-bound strings ASCII.
  it("renders no unmapped glyphs in the CO2 labels", () => {
    const raw = renderText();
    expect(raw).toContain("CO2-Einsparung");
    expect(raw).not.toContain("CO ,");
  });

  // Layout regression guard: adding the model row once pushed the cashflow
  // chart onto its own page and left half of page 1 blank.
  it("stays at three pages, so nothing spills into a half-empty page", () => {
    expect(buildReportDoc(DEFAULTS, scenarios, { now: FIXED_NOW }).getNumberOfPages()).toBe(3);
  });

  it("is byte-identical for the same inputs and the same clock", () => {
    expect(renderText().length).toBe(renderText().length);
  });
});
