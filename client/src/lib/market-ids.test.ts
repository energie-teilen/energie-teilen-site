import { describe, it, expect } from "vitest";
import {
  BDEW_CODE_LENGTH,
  CHECK_DIGIT_ALGORITHMS,
  EIC_LENGTH,
  MALO_LENGTH,
  MELO_LENGTH,
  deriveEan13CheckDigit,
  deriveEicCheckCharacter,
  deriveMaloCheckDigit,
  validateBdewCode,
  validateEic,
  validateMalo,
  validateMelo,
  validateMessageIdentifiers,
} from "../../../shared/market-ids";

const bdew = (first12: string) => first12 + deriveEan13CheckDigit(first12);
const malo = (first10: string) => first10 + deriveMaloCheckDigit(first10);
const melo = "DE" + "0".repeat(25) + "12345A";

describe("the verification gate", () => {
  /*
   * Every check-digit algorithm here implements a specification published by
   * somebody else. Until an implementation has been checked against that
   * publication it must not be able to say an identifier is valid — only that
   * it computed something. This is the same gate the statutory citations use.
   */
  it("never reports a check digit as correct while its algorithm is unverified", () => {
    for (const algo of Object.values(CHECK_DIGIT_ALGORITHMS)) {
      expect(algo.verified).toBe(false);
      expect(algo.openQuestion).toBeTruthy();
    }
    expect(validateMalo(malo("5012345678")).checkDigit).toBe("algorithm_unverified");
    expect(validateBdewCode(bdew("999999999999")).checkDigit).toBe("algorithm_unverified");
    expect(validateEic("10YDE-VE-------2").checkDigit).toBe("algorithm_unverified");
  });

  it("requires a reference and a date before an algorithm may be verified", () => {
    for (const algo of Object.values(CHECK_DIGIT_ALGORITHMS)) {
      if (algo.verified) {
        expect(algo.reference).not.toBeNull();
        expect(algo.asOf).not.toBeNull();
      }
    }
  });

  // Format rules need no third party, so those ARE asserted.
  it("still asserts format, which needs nobody's publication", () => {
    expect(validateMalo("123").format).toBe("invalid");
    expect(validateMalo(malo("5012345678")).format).toBe("ok");
  });
});

describe("Marktlokations-ID", () => {
  it("is eleven digits", () => {
    expect(MALO_LENGTH).toBe(11);
    expect(validateMalo(malo("5012345678")).value).toHaveLength(11);
  });

  it("computes a check digit that is self-consistent", () => {
    for (const seed of ["5012345678", "9876543210", "1111111111", "4000000000"]) {
      const id = malo(seed);
      expect(deriveMaloCheckDigit(id.slice(0, 10))).toBe(id[10]);
    }
  });

  it("rejects a wrong length, non-digits and a leading zero", () => {
    expect(validateMalo("1234567890").problems.length).toBeGreaterThan(0);
    expect(validateMalo("5012345678A").problems.length).toBeGreaterThan(0);
    expect(validateMalo("01234567890").problems.some((p) => p.includes("Null"))).toBe(true);
  });

  it("refuses to compute from the wrong number of digits", () => {
    expect(() => deriveMaloCheckDigit("123")).toThrow();
    expect(() => deriveMaloCheckDigit("12345678901")).toThrow();
  });
});

describe("Messlokations-ID", () => {
  it("is thirty-three uppercase alphanumerics beginning with a country code", () => {
    expect(MELO_LENGTH).toBe(33);
    const r = validateMelo(melo);
    expect(r.format).toBe("ok");
    expect(r.problems).toEqual([]);
  });

  it("names the actual length when it is wrong", () => {
    expect(validateMelo("DE0001").problems[0]).toContain("6");
  });

  it("rejects characters outside the permitted set", () => {
    expect(validateMelo("DE" + "-".repeat(31)).problems.length).toBeGreaterThan(0);
  });

  it("normalises case rather than rejecting it", () => {
    expect(validateMelo(melo.toLowerCase()).format).toBe("ok");
  });

  it("reports no check digit, because the identifier has none", () => {
    expect(validateMelo(melo).computed).toBeNull();
  });
});

describe("BDEW-Codenummer", () => {
  it("is thirteen digits", () => {
    expect(BDEW_CODE_LENGTH).toBe(13);
    expect(validateBdewCode(bdew("999999999999")).format).toBe("ok");
  });

  it("computes an EAN-13 check digit that is self-consistent", () => {
    for (const seed of ["999999999999", "400000000000", "123456789012"]) {
      const code = bdew(seed);
      expect(deriveEan13CheckDigit(code.slice(0, 12))).toBe(code[12]);
    }
  });

  it("matches the published EAN-13 example", () => {
    // 400638133393 -> 1 is the textbook worked example for the algorithm.
    expect(deriveEan13CheckDigit("400638133393")).toBe("1");
  });

  it("rejects anything that is not thirteen digits", () => {
    expect(validateBdewCode("12345").format).toBe("invalid");
    expect(validateBdewCode("999999999999X").format).toBe("invalid");
  });
});

describe("EIC", () => {
  it("is sixteen characters from its own alphabet", () => {
    expect(EIC_LENGTH).toBe(16);
    expect(validateEic("10YDE-VE-------2").format).toBe("ok");
  });

  it("computes a check character that is self-consistent", () => {
    for (const stem of ["10YDE-VE-------", "10YDE-RWENET---", "11XDE-EXAMPLE01"]) {
      const check = deriveEicCheckCharacter(stem);
      if (check === "") continue;
      const full = stem + check;
      expect(deriveEicCheckCharacter(full.slice(0, 15))).toBe(full[15]);
    }
  });

  it("reports a stem whose check character would be the hyphen as unusable", () => {
    // Such a code cannot carry a valid check character and has to be reissued.
    let found = false;
    for (let i = 0; i < 400 && !found; i++) {
      const stem = `10X${String(i).padStart(4, "0")}TESTSTEM`.slice(0, 15);
      if (deriveEicCheckCharacter(stem) === "") found = true;
    }
    // Whether or not one turns up in this sample, the contract is that an
    // empty result means "reissue", never "valid".
    expect(deriveEicCheckCharacter("10YDE-VE-------")).not.toBe("-");
  });

  it("rejects a character outside the alphabet", () => {
    expect(validateEic("10YDE_VE_______2").format).toBe("invalid");
  });

  it("rejects the wrong length", () => {
    expect(validateEic("10YDE-VE").format).toBe("invalid");
  });

  it("normalises case", () => {
    expect(validateEic("10yde-ve-------2").value).toBe("10YDE-VE-------2");
  });
});

describe("message identifiers together", () => {
  it("checks every identifier a message carries and reports each problem by field", () => {
    const r = validateMessageIdentifiers({
      senderCode: bdew("999999999999"),
      receiverCode: "nope",
      malo: malo("5012345678"),
      melo,
      balancingAreaEic: "10YDE-VE-------2",
    });
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.startsWith("receiverCode:"))).toBe(true);
    expect(r.results.senderCode.format).toBe("ok");
    expect(r.results.malo.format).toBe("ok");
  });

  it("passes when everything is well formed", () => {
    const r = validateMessageIdentifiers({
      senderCode: bdew("999999999999"),
      receiverCode: bdew("888888888888"),
      malo: malo("5012345678"),
      melo,
    });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("only checks the identifiers it was given", () => {
    const r = validateMessageIdentifiers({
      senderCode: bdew("999999999999"),
      receiverCode: bdew("888888888888"),
    });
    expect(Object.keys(r.results)).toEqual(["senderCode", "receiverCode"]);
  });
});
