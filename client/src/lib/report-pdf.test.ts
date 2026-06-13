import { describe, it, expect } from "vitest";
import { buildReportDoc, type ScenarioBundle } from "./report-pdf";
import { calculateMieterstrom, DEFAULTS } from "./mieterstrom";

const base = calculateMieterstrom(DEFAULTS);
const scenarios: ScenarioBundle = { konservativ: base, realistisch: base, optimistisch: base };

describe("buildReportDoc", () => {
  it("produces a valid non-empty PDF", () => {
    const bytes = new Uint8Array(buildReportDoc(DEFAULTS, scenarios).output("arraybuffer"));
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(bytes.length).toBeGreaterThan(2000);
  });
});
