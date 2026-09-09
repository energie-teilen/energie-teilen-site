import { describe, it, expect } from "vitest";
import {
  LEGAL_ENTITY,
  LEGAL_ENTITY_PENDING_DE,
  REQUIRED_FIELDS,
  formattedAddress,
  legalEntityPublishable,
  validateLegalEntity,
  type LegalEntity,
} from "../../../shared/legal-entity";

const COMPLETE: LegalEntity = {
  configured: true,
  name: "Beispiel Energie GmbH",
  street: "Beispielweg 1",
  postalCode: "60311",
  city: "Frankfurt am Main",
  country: "Deutschland",
  representedBy: "A. Beispiel",
  phone: "+49 69 1234567",
  email: "kontakt@energie-teilen.de",
  registerCourt: "Amtsgericht Frankfurt am Main",
  registerNumber: "HRB 123456",
  vatId: "DE123456789",
  contentResponsible: { name: "A. Beispiel", address: "Beispielweg 1, 60311 Frankfurt am Main" },
  disputeResolution: { participates: false, body: null },
};

describe("legal entity record", () => {
  it("accepts a complete record", () => {
    expect(validateLegalEntity(COMPLETE)).toEqual([]);
    expect(legalEntityPublishable(COMPLETE)).toBe(true);
  });

  it("names every missing required field rather than the first one", () => {
    const empty = { ...COMPLETE, name: "", street: "", phone: "" };
    const problems = validateLegalEntity(empty).map((p) => p.field);
    expect(problems).toEqual(expect.arrayContaining(["name", "street", "phone"]));
  });

  // A page reading "[FIRMENNAME]" is not a lesser imprint, it is a page that
  // fails its only purpose. The validator must reject template values.
  it("rejects bracketed placeholders", () => {
    for (const value of ["[FIRMENNAME]", "[STRASSE UND HAUSNUMMER]", "[PLZ] [ORT]"]) {
      expect(validateLegalEntity({ ...COMPLETE, name: value }).length).toBeGreaterThan(0);
    }
  });

  it("rejects other template shapes", () => {
    for (const value of ["HRB XXXXXX", "Platzhalter", "Mustermann GmbH", "TODO", "   "]) {
      expect(
        validateLegalEntity({ ...COMPLETE, representedBy: value }).length,
        `should reject ${JSON.stringify(value)}`,
      ).toBeGreaterThan(0);
    }
  });

  it("rejects a malformed contact address", () => {
    expect(validateLegalEntity({ ...COMPLETE, email: "kontakt(at)example" }).length).toBeGreaterThan(0);
  });

  it("requires register court and number together", () => {
    expect(
      validateLegalEntity({ ...COMPLETE, registerNumber: null }).map((p) => p.field),
    ).toContain("registerCourt");
  });

  it("requires a named body when arbitration participation is declared", () => {
    expect(
      validateLegalEntity({
        ...COMPLETE,
        disputeResolution: { participates: true, body: null },
      }).map((p) => p.field),
    ).toContain("disputeResolution");
  });

  it("withholds the formatted address until the record is publishable", () => {
    expect(formattedAddress({ ...COMPLETE, configured: false })).toBeNull();
    expect(formattedAddress(COMPLETE)).toEqual([
      "Beispiel Energie GmbH",
      "Beispielweg 1",
      "60311 Frankfurt am Main",
      "Deutschland",
    ]);
  });

  it("covers every required field in the validator", () => {
    for (const field of REQUIRED_FIELDS) {
      const broken = { ...COMPLETE, [field]: "" } as LegalEntity;
      expect(validateLegalEntity(broken).map((p) => p.field), `${field} is validated`).toContain(field);
    }
  });

  it("offers honest replacement copy while the details are missing", () => {
    expect(LEGAL_ENTITY_PENDING_DE).toMatch(/hinterlegt/);
    expect(LEGAL_ENTITY_PENDING_DE).not.toMatch(/\[/);
  });
});

/*
 * The release gate.
 *
 * This is expected to FAIL until the operator fills shared/legal-entity.ts.
 * That failure is the feature: it stops a deployment that would publish an
 * imprint made of placeholders while taking payments. It is skipped unless
 * RELEASE_CHECK=1 so ordinary development is not blocked, and CI sets that
 * variable on the production path.
 */
describe.runIf(process.env.RELEASE_CHECK === "1")("release gate", () => {
  it("the shipped legal entity record is publishable", () => {
    const problems = validateLegalEntity(LEGAL_ENTITY);
    expect(
      problems.map((p) => `${p.field}: ${p.reason}`),
      "shared/legal-entity.ts must be completed before release",
    ).toEqual([]);
    expect(LEGAL_ENTITY.configured, "set configured: true once the data is real").toBe(true);
  });
});
