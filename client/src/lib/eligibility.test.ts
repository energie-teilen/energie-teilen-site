import { describe, it, expect } from "vitest";
import {
  INSUFFICIENT_DATA_THRESHOLD,
  MIN_KWP,
  MIN_UNITS,
  evaluateEligibility,
  intakeChecklistFor,
  type EligibilityInput,
  type QualificationFacts,
} from "../../../shared/eligibility";
import { PILOT_OFFER_FULFILLMENT } from "../../../shared/pilot-order";
import { DEFAULTS, calculateMieterstrom } from "./mieterstrom";
import type { MieterstromInputs } from "../../../shared/schema";

const COMPLETE_FACTS: QualificationFacts = {
  ownerConstellation: "single_owner",
  buildingScope: "single_building",
  generationStatus: "planned",
  metering: "ready",
};

function build(
  over: Partial<MieterstromInputs> = {},
  facts?: QualificationFacts,
): EligibilityInput {
  const economics = { ...DEFAULTS, ...over };
  return { economics, kpis: calculateMieterstrom(economics).kpis, facts };
}

describe("verdict precedence", () => {
  it("returns ELIGIBLE only when everything is known and clean", () => {
    expect(evaluateEligibility(build({}, COMPLETE_FACTS)).verdict).toBe("ELIGIBLE");
  });

  it("reports INSUFFICIENT_DATA when the calculator is all it has", () => {
    const r = evaluateEligibility(build());
    expect(r.verdict).toBe("INSUFFICIENT_DATA");
    expect(r.missingData.length).toBeGreaterThanOrEqual(INSUFFICIENT_DATA_THRESHOLD);
  });

  it("softens to LIKELY_ELIGIBLE when only one fact is missing", () => {
    const { metering, ...rest } = COMPLETE_FACTS;
    expect(evaluateEligibility(build({}, rest)).verdict).toBe("LIKELY_ELIGIBLE");
  });

  // A known blocker must beat a missing fact — saying "incomplete" when we can
  // already see it cannot work would be a way of dodging the answer.
  it("lets a known blocker outrank missing data", () => {
    expect(evaluateEligibility(build({ anzahlWohneinheiten: 1 })).verdict).toBe("NOT_ELIGIBLE");
  });

  it("lets a known blocker outrank a review item", () => {
    const r = evaluateEligibility(
      build({ anzahlWohneinheiten: 1 }, { ...COMPLETE_FACTS, ownerConstellation: "weg" }),
    );
    expect(r.verdict).toBe("NOT_ELIGIBLE");
  });

  it("escalates to REQUIRES_REVIEW for a WEG constellation", () => {
    const r = evaluateEligibility(build({}, { ...COMPLETE_FACTS, ownerConstellation: "weg" }));
    expect(r.verdict).toBe("REQUIRES_REVIEW");
    expect(r.findings.map((f) => f.code)).toContain("weg_consent");
  });
});

describe("blocking rules", () => {
  it("blocks a constellation with too few units", () => {
    const r = evaluateEligibility(build({ anzahlWohneinheiten: MIN_UNITS - 1 }, COMPLETE_FACTS));
    expect(r.verdict).toBe("NOT_ELIGIBLE");
    expect(r.findings.map((f) => f.code)).toContain("units_below_threshold");
  });

  it("blocks an installation too small to carry the model's fixed costs", () => {
    const r = evaluateEligibility(build({ kwp: MIN_KWP - 1 }, COMPLETE_FACTS));
    expect(r.findings.map((f) => f.code)).toContain("kwp_below_threshold");
  });

  it("blocks a project with no generation at all", () => {
    const r = evaluateEligibility(build({}, { ...COMPLETE_FACTS, generationStatus: "none" }));
    expect(r.verdict).toBe("NOT_ELIGIBLE");
  });

  it("does not sell anything into a known blocker", () => {
    expect(evaluateEligibility(build({ anzahlWohneinheiten: 1 })).nextPaidStep).toBeNull();
  });
});

describe("review rules", () => {
  it("flags a scope the calculator's model does not cover", () => {
    const r = evaluateEligibility(build({}, { ...COMPLETE_FACTS, buildingScope: "across_grid" }));
    expect(r.verdict).toBe("REQUIRES_REVIEW");
    const finding = r.findings.find((f) => f.code === "scope_outside_model");
    expect(finding?.message).toContain("Mieterstrom");
  });

  it("flags an unclear metering concept as the real implementation risk", () => {
    const r = evaluateEligibility(build({}, { ...COMPLETE_FACTS, metering: "unclear" }));
    expect(r.findings.map((f) => f.code)).toContain("metering_unclear");
  });

  it("flags an implausibly optimistic self-consumption assumption", () => {
    const r = evaluateEligibility(build({ eigenverbrauchsquote: 0.9 }, COMPLETE_FACTS));
    expect(r.findings.map((f) => f.code)).toContain("self_consumption_optimistic");
  });

  it("treats a negative NPV as reviewable, not disqualifying", () => {
    const r = evaluateEligibility(build({ investitionEurPerKwp: 4000 }, COMPLETE_FACTS));
    expect(r.findings.map((f) => f.code)).toContain("npv_negative");
    expect(r.verdict).toBe("REQUIRES_REVIEW");
  });
});

describe("the feed-in regime change", () => {
  // The 20-year model assumes a fixed feed-in tariff; that regime is being
  // withdrawn for new plants under the EEG 2027 draft.
  it("flags a planned plant, because it will be commissioned after the change", () => {
    const r = evaluateEligibility(build({}, COMPLETE_FACTS));
    expect(r.findings.map((f) => f.code)).toContain("feed_in_regime_change");
  });

  it("does not flag a plant that already exists", () => {
    const r = evaluateEligibility(build({}, { ...COMPLETE_FACTS, generationStatus: "existing" }));
    expect(r.findings.map((f) => f.code)).not.toContain("feed_in_regime_change");
  });

  // It applies to every planned plant, so escalating the verdict on it would
  // make REQUIRES_REVIEW meaningless.
  it("does not move the verdict", () => {
    expect(evaluateEligibility(build({}, COMPLETE_FACTS)).verdict).toBe("ELIGIBLE");
  });

  it("surfaces as the main risk when nothing worse exists", () => {
    const r = evaluateEligibility(build({}, COMPLETE_FACTS));
    expect(r.mainRisk).toContain("Direktvermarktung");
  });

  it("says self-consumption is unaffected, so the wedge still holds", () => {
    const r = evaluateEligibility(build({}, COMPLETE_FACTS));
    expect(r.mainRisk).toContain("Eigenverbrauchsanteil");
  });
});

describe("it never claims legal compliance", () => {
  const cases: [string, EligibilityInput][] = [
    ["complete", build({}, COMPLETE_FACTS)],
    ["empty", build()],
    ["blocked", build({ anzahlWohneinheiten: 1 })],
    ["review", build({}, { ...COMPLETE_FACTS, ownerConstellation: "weg" })],
  ];

  for (const [name, input] of cases) {
    it(`avoids compliance language for the ${name} case`, () => {
      const r = evaluateEligibility(input);
      const prose = [
        r.feasibility,
        r.mainRisk,
        r.valueDriver,
        r.verdictLabel,
        ...r.findings.map((f) => f.message),
        r.nextPaidStep?.rationale ?? "",
      ].join(" ");
      expect(prose).not.toMatch(/rechtskonform|rechtlich zulässig|gesetzeskonform|compliant/i);
      // It also must not cite a paragraph — that gate lives in legal-models.ts.
      expect(prose).not.toMatch(/§/);
    });
  }

  it("frames its own scope as economic and structural", () => {
    expect(evaluateEligibility(build({}, COMPLETE_FACTS)).feasibility).toContain(
      "wirtschaftlichen und strukturellen",
    );
  });
});

describe("missing data is named, with a reason", () => {
  it("names every unknown fact", () => {
    const r = evaluateEligibility(build());
    expect(r.missingData).toEqual([
      "Eigentümerkonstellation",
      "Räumlicher Zuschnitt",
      "Status der Erzeugungsanlage",
      "Mess- und Zählerkonzept",
    ]);
  });

  it("says why each gap matters rather than just listing it", () => {
    const r = evaluateEligibility(build());
    for (const f of r.findings.filter((x) => x.severity === "missing")) {
      expect(f.message.length).toBeGreaterThan(60);
    }
  });

  it("empties the list as facts are supplied", () => {
    expect(evaluateEligibility(build({}, COMPLETE_FACTS)).missingData).toEqual([]);
  });
});

describe("the next paid step is specific, never 'contact us'", () => {
  it("routes an unqualified project to the cheapest qualifying step", () => {
    const r = evaluateEligibility(build());
    expect(r.nextPaidStep?.offerCode).toBe("et_eligibility");
    expect(r.nextPaidStep?.rationale).toContain("kleinsten Einsatz");
  });

  it("routes a qualified simple project to structuring", () => {
    expect(evaluateEligibility(build({}, COMPLETE_FACTS)).nextPaidStep?.offerCode).toBe(
      "et_structuring",
    );
  });

  it("routes a qualified multi-party project to the mandate", () => {
    const r = evaluateEligibility(
      build({ anzahlWohneinheiten: 60 }, { ...COMPLETE_FACTS, ownerConstellation: "single_owner" }),
    );
    expect(r.nextPaidStep?.offerCode).toBe("et_mandate");
  });

  it("reuses the tier's own intake checklist, so nothing is asked twice", () => {
    const r = evaluateEligibility(build({}, COMPLETE_FACTS));
    expect(intakeChecklistFor(r.nextPaidStep)).toEqual(
      PILOT_OFFER_FULFILLMENT.et_structuring.requiredData,
    );
    expect(intakeChecklistFor(null)).toEqual([]);
  });

  it("never emits a generic contact prompt", () => {
    for (const input of [build(), build({}, COMPLETE_FACTS)]) {
      const r = evaluateEligibility(input);
      expect(r.nextPaidStep?.rationale ?? "").not.toMatch(/kontaktieren|melden Sie sich|Kontakt/i);
    }
  });
});

describe("effort is a scope band, not a delivery promise", () => {
  it("reports a band, never a date or a duration", () => {
    for (const input of [build(), build({}, COMPLETE_FACTS)]) {
      const effort = evaluateEligibility(input).estimatedEffort;
      expect(["gering", "mittel", "hoch"]).toContain(effort);
      expect(effort).not.toMatch(/Tag|Woche|Werktag/i);
    }
  });

  // Absence of an answer is uncertainty, not complexity. This once reported
  // "hoch" for every visitor who answered nothing.
  it("does not read an unanswered scope question as high effort", () => {
    expect(evaluateEligibility(build()).estimatedEffort).toBe("mittel");
  });

  it("raises effort only for a KNOWN multi-site scope", () => {
    expect(
      evaluateEligibility(build({}, { ...COMPLETE_FACTS, buildingScope: "across_grid" }))
        .estimatedEffort,
    ).toBe("hoch");
  });

  it("scales with the number of parties involved", () => {
    expect(
      evaluateEligibility(build({}, { ...COMPLETE_FACTS, ownerConstellation: "weg" }))
        .estimatedEffort,
    ).toBe("hoch");
    expect(evaluateEligibility(build({}, COMPLETE_FACTS)).estimatedEffort).toBe("gering");
  });
});

describe("value driver and main risk are concrete", () => {
  it("names the weakest actionable lever", () => {
    expect(evaluateEligibility(build({ eigenverbrauchsquote: 0.25 })).valueDriver).toContain(
      "Eigenverbrauchsquote",
    );
    expect(evaluateEligibility(build({ investitionEurPerKwp: 1900 })).valueDriver).toContain(
      "Investitionskosten",
    );
  });

  it("surfaces the blocker as the main risk when one exists", () => {
    expect(evaluateEligibility(build({ anzahlWohneinheiten: 1 })).mainRisk).toContain("Einheiten");
  });
});
