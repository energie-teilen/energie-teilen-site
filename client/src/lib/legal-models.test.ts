import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  LEGAL_MODELS,
  LEGAL_MODEL_ORDER,
  calculatorCoverageStatement,
  formatCitation,
  modelLabel,
  modelledByCalculator,
} from "../../../shared/legal-models";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("legal model register", () => {
  it("keeps the three models distinct rather than collapsing them", () => {
    expect(LEGAL_MODEL_ORDER).toHaveLength(3);
    const scopes = LEGAL_MODEL_ORDER.map((id) => LEGAL_MODELS[id].scope);
    expect(new Set(scopes).size).toBe(3);
  });

  it("states plainly that the engine computes exactly one of them", () => {
    expect(modelledByCalculator().id).toBe("mieterstrom");
    expect(
      LEGAL_MODEL_ORDER.filter((id) => LEGAL_MODELS[id].modelledByCalculator),
    ).toHaveLength(1);
  });

  it("names the models it does NOT compute, so coverage cannot be implied", () => {
    const statement = calculatorCoverageStatement();
    expect(statement).toContain("Mieterstrom");
    expect(statement).toContain("Gemeinschaftliche Gebäudeversorgung");
    expect(statement).toContain("Energy Sharing");
    expect(statement).toContain("nicht berechnet");
  });

  it("describes each model without asserting a statutory scope in the prose", () => {
    for (const id of LEGAL_MODEL_ORDER) {
      const m = LEGAL_MODELS[id];
      expect(m.summary, `${id} summary`).not.toMatch(/§/);
      expect(m.scope, `${id} scope`).not.toMatch(/§/);
      expect(m.summary.length).toBeGreaterThan(40);
    }
  });
});

describe("the citation gate", () => {
  // An unverified paragraph number must not reach a user.
  it("renders no citation for any model until someone verifies it", () => {
    for (const id of LEGAL_MODEL_ORDER) {
      expect(formatCitation(LEGAL_MODELS[id]), `${id} must not render a citation`).toBeNull();
      expect(modelLabel(LEGAL_MODELS[id])).not.toMatch(/§/);
    }
  });

  it("refuses to render even a 'verified' citation that has no reference or date", () => {
    const half = {
      ...LEGAL_MODELS.mieterstrom,
      citation: { paragraph: "§ 42a", act: "EnWG", verified: true, reference: null, asOf: null },
    };
    expect(formatCitation(half)).toBeNull();
  });

  it("renders once a citation is genuinely verified", () => {
    const done = {
      ...LEGAL_MODELS.mieterstrom,
      citation: {
        paragraph: "§ 42a",
        act: "EnWG",
        verified: true,
        reference: "Prüfung durch RA X",
        asOf: "2026-09-06",
      },
    };
    expect(formatCitation(done)).toBe("§ 42a EnWG");
    expect(modelLabel(done)).toBe("Mieterstrom (§ 42a EnWG)");
  });

  it("records what still needs checking for every unverified model", () => {
    for (const id of LEGAL_MODEL_ORDER) {
      const c = LEGAL_MODELS[id].citation;
      if (c && !c.verified) {
        expect(c.openQuestion?.length ?? 0, `${id} openQuestion`).toBeGreaterThan(20);
      }
    }
  });
});

// ============================================================================
// THE BUILD GUARD
// ----------------------------------------------------------------------------
// "Never hard-code legal claims in UI copy" is only a rule if something
// enforces it. This walks the shipped source — index.html included, because
// that is where the Schema.org FAQ lived — and fails on any statutory citation
// outside the register and the legal pages.
// ============================================================================

const SCAN_DIRS = ["client/src", "shared", "server", "api"];
const SCAN_FILES = ["client/index.html"];
/**
 * Statutory citations may live in exactly two registers and the legal pages.
 * A register stores them as DATA behind a gate that renders them only once
 * verified; everywhere else they would be uncontrolled copy.
 */
const REGISTERS = ["shared/legal-models.ts", "shared/tariffs.ts"];
const ALLOWED = [
  ...REGISTERS,
  "client/src/pages/legal/", // Impressum / Datenschutz / AGB legitimately cite law
];
const CITATION_PATTERN = /§\s*\d+[a-z]?\s*(EnWG|EEG|BGB|MsbG)|§§/;

function collect(dir: string, acc: string[] = []): string[] {
  const abs = path.join(REPO_ROOT, dir);
  for (const entry of readdirSync(abs)) {
    const rel = path.join(dir, entry);
    const full = path.join(REPO_ROOT, rel);
    if (statSync(full).isDirectory()) {
      collect(rel, acc);
    } else if (/\.(ts|tsx|html)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      acc.push(rel);
    }
  }
  return acc;
}

describe("no hard-coded statutory citations outside the register", () => {
  // Pinned so a third register cannot be added quietly to dodge the guard.
  it("permits exactly two registers", () => {
    expect(REGISTERS).toEqual(["shared/legal-models.ts", "shared/tariffs.ts"]);
  });

  it("scans a meaningful number of files", () => {
    const files = [...SCAN_DIRS.flatMap((d) => collect(d)), ...SCAN_FILES];
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("client/index.html");
  });

  it("finds none in shipped source, SEO metadata or structured data", () => {
    const files = [...SCAN_DIRS.flatMap((d) => collect(d)), ...SCAN_FILES].filter(
      (f) => !ALLOWED.some((a) => f.startsWith(a)),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(path.join(REPO_ROOT, file), "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (CITATION_PATTERN.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }

    expect(
      offenders,
      `Statutory citations must go through shared/legal-models.ts, which renders them only once verified:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
