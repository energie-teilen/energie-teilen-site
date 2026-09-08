import { describe, it, expect } from "vitest";
import {
  DEFAULT_SERVICE_CHARACTERS,
  EdifactError,
  buildInterchange,
  escapeValue,
  parseInterchange,
  readSegment,
  serviceStringAdvice,
  splitSegments,
  unescapeValue,
  verifyInterchange,
  writeSegment,
  type MessageBody,
  type Segment,
} from "../../../shared/edifact";

const C = DEFAULT_SERVICE_CHARACTERS;

/** Values built specifically out of the characters that break naive code. */
const ADVERSARIAL = [
  "plain",
  "with+plus",
  "with:colon",
  "with'apostrophe",
  "with?release",
  "??double",
  "+:'?all four",
  "1-1:2.29.0",
  "Müller & Söhne GmbH + Co. KG",
  "ends with release?",
  "'",
  "?",
  "+",
  ":",
];

describe("service characters", () => {
  it("announces the set it uses", () => {
    expect(serviceStringAdvice()).toBe("UNA:+.? '");
    expect(serviceStringAdvice()).toHaveLength(9);
  });

  // Not the EDIFACT default, which is why it has to be declared.
  it("declares the point as the decimal mark", () => {
    expect(C.decimal).toBe(".");
  });
});

describe("escaping", () => {
  it.each(ADVERSARIAL)("round-trips %j", (value) => {
    expect(unescapeValue(escapeValue(value))).toBe(value);
  });

  it("escapes the release character first, so nothing is double-escaped", () => {
    expect(escapeValue("?+")).toBe("???+");
    expect(unescapeValue("???+")).toBe("?+");
  });

  it("escapes every reserved character and nothing else", () => {
    expect(escapeValue("a+b:c'd?e")).toBe("a?+b?:c?'d??e");
    expect(escapeValue("a.b-c/d")).toBe("a.b-c/d");
  });

  it("rejects a value ending in an unconsumed release character", () => {
    expect(() => unescapeValue("abc?")).toThrow(EdifactError);
  });
});

describe("segments", () => {
  it("writes tag and elements separated correctly", () => {
    expect(writeSegment({ tag: "UNS", elements: ["D"] })).toBe("UNS+D'");
    expect(writeSegment({ tag: "NAD", elements: ["MS", ["123", "", "293"]] })).toBe(
      "NAD+MS+123::293'",
    );
  });

  it("writes an omitted component as empty rather than dropping it", () => {
    expect(writeSegment({ tag: "BGM", elements: [["7", null, undefined, "9"]] })).toBe("BGM+7:::9'");
  });

  it("omits trailing empty elements", () => {
    expect(writeSegment({ tag: "DTM", elements: ["a", "", null] })).toBe("DTM+a'");
  });

  it("writes numbers with the declared decimal mark", () => {
    expect(writeSegment({ tag: "QTY", elements: [["220", 0.125, "KWH"]] })).toBe("QTY+220:0.125:KWH'");
  });

  it("refuses a non-finite number rather than writing NaN to the wire", () => {
    expect(() => writeSegment({ tag: "QTY", elements: [["220", Number.NaN]] })).toThrow(EdifactError);
    expect(() => writeSegment({ tag: "QTY", elements: [["220", Infinity]] })).toThrow(EdifactError);
  });

  it("refuses an invalid segment tag", () => {
    expect(() => writeSegment({ tag: "qty", elements: [] })).toThrow(EdifactError);
    expect(() => writeSegment({ tag: "QUANTITY", elements: [] })).toThrow(EdifactError);
  });

  // This is the failure mode: a value containing a reserved character has to
  // survive the trip, and string concatenation does not achieve that.
  it.each(ADVERSARIAL)("round-trips %j through a segment", (value) => {
    const seg: Segment = { tag: "FTX", elements: [value, [value, value]] };
    const parsed = readSegment(writeSegment(seg));
    expect(parsed.tag).toBe("FTX");
    expect(parsed.elements[0]).toBe(value);
    expect(parsed.elements[1]).toEqual([value, value]);
  });

  it("keeps an OBIS code intact although it contains the component separator", () => {
    const written = writeSegment({ tag: "PIA", elements: ["5", ["1-1:2.29.0", "SRW"]] });
    expect(written).toBe("PIA+5+1-1?:2.29.0:SRW'");
    expect(readSegment(written).elements[1]).toEqual(["1-1:2.29.0", "SRW"]);
  });
});

describe("splitting", () => {
  it("does not treat an escaped terminator as a boundary", () => {
    const message = writeSegment({ tag: "FTX", elements: ["it's here"] }) + writeSegment({ tag: "UNS", elements: ["D"] });
    expect(splitSegments(message)).toHaveLength(2);
    expect(readSegment(splitSegments(message)[0]).elements[0]).toBe("it's here");
  });

  it("rejects an unterminated final segment", () => {
    expect(() => splitSegments("UNS+D")).toThrow(EdifactError);
  });

  it("rejects a message ending in a release character", () => {
    expect(() => splitSegments("UNS+D'FTX+abc?")).toThrow(EdifactError);
  });
});

describe("interchange", () => {
  const header = {
    sender: { id: "9999999999994", qualifier: "500" },
    receiver: { id: "8888888888888", qualifier: "500" },
    preparedAt: { date: "260907", time: "1200" },
    controlReference: "REF00001",
    applicationReference: "MSCONS",
  };

  const message = (reference: string, bodySegments: number): MessageBody => ({
    reference,
    identifier: ["MSCONS", "D", "04B", "UN", "2.4c"],
    segments: Array.from({ length: bodySegments }, (_, i) => ({
      tag: "LIN" as const,
      elements: [String(i + 1)],
    })),
  });

  it("opens with the service string advice and UNB, and closes with UNZ", () => {
    const out = buildInterchange(header, [message("M1", 3)]);
    expect(out.startsWith("UNA:+.? 'UNB+")).toBe(true);
    expect(out.endsWith("UNZ+1+REF00001'")).toBe(true);
  });

  // UNT counts UNH and UNT themselves. Off-by-one here is the single most
  // common reason a message is rejected.
  it("counts UNH and UNT into the UNT segment count", () => {
    for (const bodySegments of [0, 1, 5, 400]) {
      const out = buildInterchange(header, [message("M1", bodySegments)]);
      expect(out).toContain(`UNT+${bodySegments + 2}+M1'`);
    }
  });

  it("counts the messages in UNZ and repeats the control reference", () => {
    const out = buildInterchange(header, [message("M1", 2), message("M2", 2)]);
    expect(out).toContain("UNZ+2+REF00001'");
    expect(verifyInterchange(out).messageCount).toBe(2);
  });

  it("refuses an interchange with no message", () => {
    expect(() => buildInterchange(header, [])).toThrow(EdifactError);
  });

  it("refuses two messages sharing a reference", () => {
    expect(() => buildInterchange(header, [message("M1", 1), message("M1", 1)])).toThrow(
      /mehrfach/,
    );
  });

  it("marks a test interchange as such", () => {
    expect(buildInterchange({ ...header, testIndicator: true }, [message("M1", 1)])).toMatch(
      /\+1'UNH/,
    );
  });

  it("parses back to the segments it was built from", () => {
    const out = buildInterchange(header, [message("M1", 4)]);
    const parsed = parseInterchange(out);
    expect(parsed.chars).toEqual(DEFAULT_SERVICE_CHARACTERS);
    expect(parsed.segments.map((s) => s.tag)).toEqual([
      "UNB", "UNH", "LIN", "LIN", "LIN", "LIN", "UNT", "UNZ",
    ]);
  });

  it("honours service characters declared by a foreign UNA", () => {
    const foreign = "UNA;*.! ~SEG*a;b~";
    const parsed = parseInterchange(foreign);
    expect(parsed.chars.component).toBe(";");
    expect(parsed.chars.element).toBe("*");
    expect(parsed.segments[0]).toEqual({ tag: "SEG", elements: [["a", "b"]] });
  });
});

describe("integrity verification", () => {
  const header = {
    sender: { id: "9999999999994", qualifier: "500" },
    receiver: { id: "8888888888888", qualifier: "500" },
    preparedAt: { date: "260907", time: "1200" },
    controlReference: "REF00001",
  };
  const body: MessageBody = {
    reference: "M1",
    identifier: ["MSCONS", "D", "04B", "UN", "2.4c"],
    segments: [{ tag: "LIN", elements: ["1"] }, { tag: "LIN", elements: ["2"] }],
  };

  it("passes a well-formed interchange", () => {
    const r = verifyInterchange(buildInterchange(header, [body]));
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // The verifier reads the produced message from the outside, so these cases
  // establish that it would actually catch a builder that went wrong.
  it("catches a wrong UNT segment count", () => {
    const broken = buildInterchange(header, [body]).replace("UNT+4+M1", "UNT+9+M1");
    const r = verifyInterchange(broken);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("unt_count_mismatch");
  });

  it("catches a UNT pointing at the wrong message", () => {
    const broken = buildInterchange(header, [body]).replace("UNT+4+M1", "UNT+4+M2");
    expect(verifyInterchange(broken).findings.map((f) => f.code)).toContain(
      "unt_reference_mismatch",
    );
  });

  it("catches a UNZ control reference that does not match UNB", () => {
    const broken = buildInterchange(header, [body]).replace("UNZ+1+REF00001", "UNZ+1+OTHER");
    expect(verifyInterchange(broken).findings.map((f) => f.code)).toContain(
      "control_reference_mismatch",
    );
  });

  it("catches a UNZ message count that does not match the content", () => {
    const broken = buildInterchange(header, [body]).replace("UNZ+1+", "UNZ+7+");
    expect(verifyInterchange(broken).findings.map((f) => f.code)).toContain("unz_count_mismatch");
  });

  it("catches a message that is never closed", () => {
    const broken = buildInterchange(header, [body]).replace("UNT+4+M1'", "");
    expect(verifyInterchange(broken).findings.map((f) => f.code)).toContain("unclosed_message");
  });
});
