import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import {
  LEGAL_ENTITY,
  REQUIRED_FIELDS,
  contactEmail,
  disputeResolutionStatement,
  legalEntityPublishable,
  operatorLocality,
  operatorName,
  type LegalEntity,
} from "../../../shared/legal-entity";

/*
 * One record of who operates the site.
 *
 * shared/legal-entity.ts is the only place the operator is described. These
 * guards encode defects that were actually shipped: a contact address typed
 * into six files, a city ("Frankfurt am Main", in the footer, the PDF, the
 * hero and a LocalBusiness node with a postal address in the structured data)
 * that the record itself does not state, and an imprint that declared a
 * dispute-resolution position on behalf of an operator not yet named.
 */

const ROOT = join(__dirname, "..", "..", "..");

const COMPLETE: LegalEntity = {
  configured: true,
  name: "Beispiel Energie GmbH",
  street: "Beispielweg 1",
  postalCode: "60311",
  city: "Beispielstadt",
  country: "Deutschland",
  representedBy: "A. Beispiel",
  phone: "+49 69 1234567",
  email: "kontakt@beispiel-energie.de",
  registerCourt: "Amtsgericht Beispielstadt",
  registerNumber: "HRB 123456",
  vatId: "DE123456789",
  contentResponsible: null,
  disputeResolution: { participates: false, body: null },
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", "public"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/** Everything that ships or generates something a visitor, a crawler or a customer reads. */
const SHIPPED = [
  ...["client/src", "server", "shared", "scripts", "api"].flatMap((d) => walk(join(ROOT, d))),
  join(ROOT, "client", "index.html"),
]
  .filter((f) => /\.(ts|tsx|mjs|html)$/.test(f) && !/\.test\.ts$/.test(f))
  .map((f) => relative(ROOT, f).split("\\").join("/"));

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * Addresses that are allowed as literals because they are NOT the operator's
 * contact mailbox. Each needs a reason; adding one here is a review decision.
 */
const NON_OPERATOR_ADDRESSES: Record<string, string> = {
  "noreply@energie-teilen.de": "default Resend sender, reported by /api/health when RESEND_FROM_EMAIL is unset",
  "noreply@ihre-domain.de": "format example inside a fix instruction",
  "ihre@firma.de": "input placeholder for the visitor's own address",
  "name@unternehmen.de": "input placeholder for the visitor's own address",
};

/** Static HTML cannot import the record; it is checked against it instead. */
const MAY_SPELL_OUT_THE_MAILBOX = ["shared/legal-entity.ts", "client/index.html"];

describe("the operator record's read-only views", () => {
  it("exposes the contact mailbox, and nothing for an address that is not one", () => {
    expect(contactEmail(COMPLETE)).toBe("kontakt@beispiel-energie.de");
    expect(contactEmail({ ...COMPLETE, email: "kontakt(at)beispiel" })).toBeNull();
    expect(contactEmail({ ...COMPLETE, email: "" })).toBeNull();
  });

  it("withholds name and locality until the record is publishable", () => {
    expect(operatorName(COMPLETE)).toBe("Beispiel Energie GmbH");
    expect(operatorLocality(COMPLETE)).toBe("Beispielstadt, Deutschland");
    for (const entity of [{ ...COMPLETE, configured: false }, { ...COMPLETE, city: "" }]) {
      expect(operatorName(entity)).toBeNull();
      expect(operatorLocality(entity)).toBeNull();
    }
  });

  it("does not publish the dispute-resolution default as the operator's declaration", () => {
    expect(disputeResolutionStatement({ ...COMPLETE, configured: false })).toBeNull();
    expect(disputeResolutionStatement(COMPLETE)).toMatch(/nicht bereit und nicht verpflichtet/);
    expect(
      disputeResolutionStatement({
        ...COMPLETE,
        disputeResolution: { participates: true, body: "Beispiel-Schlichtungsstelle" },
      }),
    ).toMatch(/Beispiel-Schlichtungsstelle/);
  });

  it("agrees with the shipped record, whatever state it is in", () => {
    const publishable = legalEntityPublishable();
    expect(operatorName() === null).toBe(!publishable);
    expect(operatorLocality() === null).toBe(!publishable);
    expect(disputeResolutionStatement() === null).toBe(!publishable);
  });
});

describe("no surface describes the operator on its own", () => {
  it("scans a meaningful set of files", () => {
    expect(SHIPPED.length).toBeGreaterThan(60);
    for (const f of [
      "client/index.html",
      "client/src/components/Footer.tsx",
      "client/src/lib/report-pdf.ts",
      "server/index.ts",
      "scripts/build-discovery.mjs",
    ]) {
      expect(SHIPPED).toContain(f);
    }
  });

  it("writes the operator mailbox only in the record (and the static shell, checked below)", () => {
    const offenders: string[] = [];
    for (const file of SHIPPED) {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const [address] of line.matchAll(EMAIL)) {
          if (address === LEGAL_ENTITY.email) {
            if (!MAY_SPELL_OUT_THE_MAILBOX.includes(file)) offenders.push(`${file}:${i + 1} ${address}`);
          } else if (!(address in NON_OPERATOR_ADDRESSES)) {
            offenders.push(`${file}:${i + 1} ${address} (unknown address)`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the static shell's addresses equal to the record", () => {
    const html = readFileSync(join(ROOT, "client", "index.html"), "utf8");
    const found = [...html.matchAll(EMAIL)].map((m) => m[0]);
    expect(found.length).toBeGreaterThan(0);
    for (const address of found) expect(address).toBe(LEGAL_ENTITY.email);
  });

  it("states no operator location in the static shell while the record is not publishable", () => {
    const html = readFileSync(join(ROOT, "client", "index.html"), "utf8");
    if (!legalEntityPublishable()) {
      expect(html).not.toMatch(/PostalAddress|LocalBusiness|addressLocality/);
    }
  });

  it("hard-codes no operator city in shipped source", () => {
    // The city that was shipped as the operator's location. A visitor's own
    // project location in an input placeholder is not an operator claim.
    const offenders: string[] = [];
    for (const file of SHIPPED.filter((f) => f !== "shared/legal-entity.ts")) {
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/Frankfurt/.test(line) && !/placeholder=/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("reads the record on every surface that names a contact", () => {
    for (const file of [
      "client/src/components/Footer.tsx",
      "client/src/lib/report-pdf.ts",
      "client/src/pages/Home.tsx",
      "client/src/pages/legal/Impressum.tsx",
      "client/src/pages/legal/Datenschutz.tsx",
      "client/src/pages/legal/Agb.tsx",
      "server/index.ts",
      "scripts/manifest-entry.ts",
    ]) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).toMatch(/shared\/legal-entity/);
    }
    expect(readFileSync(join(ROOT, "scripts", "build-discovery.mjs"), "utf8")).toMatch(
      /manifests\.contactEmail\(\)/,
    );
  });
});

describe("the go-live instructions", () => {
  it("document every field the release gate requires", () => {
    const runbook = readFileSync(join(ROOT, "docs", "RUNBOOK.md"), "utf8");
    expect(runbook).toMatch(/## Operator identity/);
    for (const field of [
      ...REQUIRED_FIELDS,
      "registerCourt",
      "registerNumber",
      "vatId",
      "contentResponsible",
      "disputeResolution",
      "configured",
    ]) {
      expect(runbook, field).toContain(`\`${field}\``);
    }
  });
});
