import { describe, it, expect } from "vitest";
import {
  MSCONS_PROFILE,
  MSCONS_READINESS_NOTE_DE,
  MsconsError,
  OBIS,
  buildMscons,
  obisForInterval,
  type MsconsInput,
} from "../../../shared/mscons";
import { parseInterchange, verifyInterchange, type DataElement } from "../../../shared/edifact";
import { dayGrid, rangeGrid } from "../../../shared/market-time";
import { deriveEan13CheckDigit, deriveMaloCheckDigit } from "../../../shared/market-ids";
import { allocate, illustrativeDayProfile, illustrativeShares } from "../../../shared/allocation";

const SENDER = "999999999999" + deriveEan13CheckDigit("999999999999");
const RECEIVER = "888888888888" + deriveEan13CheckDigit("888888888888");
const MALO = "5012345678" + deriveMaloCheckDigit("5012345678");
const MELO = "DE" + "0".repeat(25) + "12345A";
const PREPARED = Date.parse("2026-09-07T10:00:00Z");

function flat(el: DataElement | undefined): string {
  return el === undefined ? "" : Array.isArray(el) ? String(el[0] ?? "") : String(el ?? "");
}

function build(date: string, over: Partial<MsconsInput> = {}) {
  const g = dayGrid(date);
  return buildMscons({
    period: { date },
    sender: { code: SENDER },
    receiver: { code: RECEIVER },
    locations: [
      {
        melo: MELO,
        malo: MALO,
        direction: "consumption",
        valuesKwh: Array.from({ length: g.intervals }, (_, i) => (i % 4 === 0 ? 0.25 : 0.125)),
      },
    ],
    preparedAtMs: PREPARED,
    ...over,
  });
}

describe("syntax integrity", () => {
  it("produces an interchange that verifies from the outside", () => {
    for (const date of ["2026-06-15", "2026-03-29", "2026-10-25"]) {
      const r = verifyInterchange(build(date).message);
      expect(r.findings).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it("emits the segments an MSCONS message is made of", () => {
    const tags = parseInterchange(build("2026-06-15").message).segments.map((s) => s.tag);
    expect(tags[0]).toBe("UNB");
    expect(tags[1]).toBe("UNH");
    expect(tags).toContain("BGM");
    expect(tags).toContain("UNS");
    expect(tags).toContain("LOC");
    expect(tags).toContain("PIA");
    expect(tags).toContain("QTY");
    expect(tags[tags.length - 1]).toBe("UNZ");
  });

  it("declares the message type and directory in UNH", () => {
    const unh = parseInterchange(build("2026-06-15").message).segments.find((s) => s.tag === "UNH")!;
    expect(unh.elements[1]).toEqual(["MSCONS", "D", "04B", "UN", "2.4c"]);
  });

  /*
   * The OBIS code contains the component separator. Written by concatenation
   * it would split the element and change what was reported; escaped, it
   * survives the round trip.
   */
  it("keeps the OBIS code intact on the wire", () => {
    const out = build("2026-06-15");
    expect(out.message).toContain("PIA+5+1-1?:1.29.0:SRW'");
    const pia = parseInterchange(out.message).segments.find((s) => s.tag === "PIA")!;
    expect(pia.elements[1]).toEqual([OBIS.consumptionInterval, "SRW"]);
  });

  it("selects the OBIS code by energy direction", () => {
    expect(obisForInterval("consumption")).toBe(OBIS.consumptionInterval);
    expect(obisForInterval("feed_in")).toBe(OBIS.feedInInterval);
    expect(build("2026-06-15", {
      locations: [{ melo: MELO, direction: "feed_in", valuesKwh: new Array(96).fill(0.1) }],
    }).message).toContain("1-1?:2.29.0");
  });

  it("is reproducible for the same input and the same clock", () => {
    expect(build("2026-06-15").message).toBe(build("2026-06-15").message);
  });
});

describe("the clock-change days", () => {
  it("carries 92 values on the short day and 100 on the long one", () => {
    expect(build("2026-03-29").grid.intervals).toBe(92);
    expect(build("2026-10-25").grid.intervals).toBe(100);
    expect(build("2026-06-15").grid.intervals).toBe(96);
  });

  it("emits exactly one quantity per interval", () => {
    for (const [date, expected] of [["2026-03-29", 92], ["2026-06-15", 96], ["2026-10-25", 100]] as const) {
      const qty = parseInterchange(build(date).message).segments.filter((s) => s.tag === "QTY");
      expect(qty).toHaveLength(expected);
    }
  });

  /*
   * The failure this whole module exists to prevent: a series sized 96 for a
   * day that is not 96 intervals long. Padding or truncating it would file
   * wrong quantities; the message is refused instead, and the error says why.
   */
  it("refuses a 96-value series on a clock-change day, and names the reason", () => {
    for (const date of ["2026-03-29", "2026-10-25"]) {
      expect(() =>
        buildMscons({
          period: { date },
          sender: { code: SENDER },
          receiver: { code: RECEIVER },
          locations: [{ melo: MELO, direction: "consumption", valuesKwh: new Array(96).fill(0.1) }],
          preparedAtMs: PREPARED,
        }),
      ).toThrow(/Zeitumstellung/);
    }
  });

  it("warns that the period contains a clock change", () => {
    expect(build("2026-10-25").warnings.map((w) => w.code)).toContain("dst_day_in_period");
    expect(build("2026-06-15").warnings.map((w) => w.code)).not.toContain("dst_day_in_period");
  });

  it("distinguishes the two 02:00 quarter-hours by their UTC offset", () => {
    const dtms = parseInterchange(build("2026-10-25").message)
      .segments.filter((s) => s.tag === "DTM")
      .map((s) => (Array.isArray(s.elements[0]) ? String(s.elements[0][1]) : ""))
      .filter((v) => v.startsWith("202610250200"));
    expect(dtms).toContain("202610250200+02");
    expect(dtms).toContain("202610250200+01");
  });

  it("stamps every interval with a distinct instant", () => {
    const starts = parseInterchange(build("2026-10-25").message)
      .segments.filter((s) => s.tag === "DTM")
      .map((s) => (Array.isArray(s.elements[0]) ? `${s.elements[0][0]}:${s.elements[0][1]}` : ""))
      .filter((v) => v.startsWith("163:"));
    // One per interval plus the one for the reporting period.
    expect(new Set(starts).size).toBe(starts.length - 1);
  });
});

describe("identifier validation before anything is sent", () => {
  it("refuses a malformed sender code", () => {
    expect(() => build("2026-06-15", { sender: { code: "123" } })).toThrow(MsconsError);
  });

  it("refuses a Messlokation of the wrong length", () => {
    expect(() =>
      build("2026-06-15", {
        locations: [{ melo: "DE0001", direction: "consumption", valuesKwh: new Array(96).fill(0.1) }],
      }),
    ).toThrow(/33 Stellen/);
  });

  it("refuses the same Messlokation twice for one direction", () => {
    const values = new Array(96).fill(0.1);
    expect(() =>
      build("2026-06-15", {
        locations: [
          { melo: MELO, direction: "consumption", valuesKwh: values },
          { melo: MELO, direction: "consumption", valuesKwh: values },
        ],
      }),
    ).toThrow(/mehrfach/);
  });

  it("permits the same Messlokation for both directions", () => {
    const values = new Array(96).fill(0.1);
    const out = build("2026-06-15", {
      locations: [
        { melo: MELO, direction: "consumption", valuesKwh: values },
        { melo: MELO, direction: "feed_in", valuesKwh: values },
      ],
    });
    expect(out.totals).toHaveLength(2);
  });

  it("refuses a negative or non-finite value rather than sending it", () => {
    const bad = new Array(96).fill(0.1);
    bad[5] = -1;
    expect(() =>
      build("2026-06-15", { locations: [{ melo: MELO, direction: "consumption", valuesKwh: bad }] }),
    ).toThrow(MsconsError);
  });

  it("refuses a status series that does not match the values", () => {
    expect(() =>
      build("2026-06-15", {
        locations: [
          {
            melo: MELO,
            direction: "consumption",
            valuesKwh: new Array(96).fill(0.1),
            statuses: ["measured"],
          },
        ],
      }),
    ).toThrow(/Statusangaben/);
  });
});

describe("value status", () => {
  /*
   * Settlement treats a substituted value differently from a measured one.
   * Emitting everything as measured would be a quiet misstatement.
   */
  it("marks substituted and estimated values with their own qualifier", () => {
    const statuses = new Array(96).fill("measured") as ("measured" | "substituted" | "estimated")[];
    statuses[10] = "substituted";
    statuses[20] = "estimated";
    const out = build("2026-06-15", {
      locations: [
        { melo: MELO, direction: "consumption", valuesKwh: new Array(96).fill(0.1), statuses },
      ],
    });
    const qualifiers = parseInterchange(out.message)
      .segments.filter((s) => s.tag === "QTY")
      .map((s) => (Array.isArray(s.elements[0]) ? String(s.elements[0][0]) : ""));
    expect(qualifiers.filter((q) => q === "220")).toHaveLength(94);
    expect(qualifiers.filter((q) => q === "67")).toHaveLength(1);
    expect(qualifiers.filter((q) => q === "79")).toHaveLength(1);
  });
});

describe("profile readiness", () => {
  /*
   * The syntax being provably right does not make the segment usage right.
   * While the profile is unverified the interchange is flagged as a test and
   * the result says so, rather than implying the message is ready to send.
   */
  it("marks the interchange as a test while the profile is unverified", () => {
    expect(MSCONS_PROFILE.verified).toBe(false);
    const out = build("2026-06-15");
    expect(out.warnings.map((w) => w.code)).toContain("profile_unverified");
    expect(out.warnings.find((w) => w.code === "profile_unverified")!.message).toBe(
      MSCONS_READINESS_NOTE_DE,
    );
  });

  it("separates the verified syntax from the unverified profile in what it claims", () => {
    expect(MSCONS_READINESS_NOTE_DE).toMatch(/Syntax dieser Nachricht ist geprüft/);
    expect(MSCONS_READINESS_NOTE_DE).toMatch(/nicht verifizierten Profilfassung/);
  });

  it("requires a reference and a date before the profile may be verified", () => {
    if (MSCONS_PROFILE.verified) {
      expect(MSCONS_PROFILE.reference).not.toBeNull();
      expect(MSCONS_PROFILE.asOf).not.toBeNull();
    } else {
      expect(MSCONS_PROFILE.openQuestion).toBeTruthy();
    }
  });
});

describe("ranges and reconciliation", () => {
  it("accepts a multi-day range at the range's own interval count", () => {
    const r = rangeGrid("2026-10-24", "2026-10-27");
    const out = buildMscons({
      period: { from: "2026-10-24", to: "2026-10-27" },
      sender: { code: SENDER },
      receiver: { code: RECEIVER },
      locations: [
        { melo: MELO, direction: "consumption", valuesKwh: new Array(r.intervals).fill(0.1) },
      ],
      preparedAtMs: PREPARED,
    });
    expect(out.grid.intervals).toBe(3 * 96 + 4);
    expect(out.grid.dstDays).toEqual([{ date: "2026-10-25", intervals: 100 }]);
    expect(verifyInterchange(out.message).ok).toBe(true);
  });

  it("reports totals that match the values it was given", () => {
    const g = dayGrid("2026-06-15");
    const values = Array.from({ length: g.intervals }, (_, i) => i / 1000);
    const out = build("2026-06-15", {
      locations: [{ melo: MELO, direction: "consumption", valuesKwh: values }],
    });
    expect(out.totals[0].values).toBe(96);
    expect(out.totals[0].kwh).toBeCloseTo(values.reduce((s, v) => s + v, 0), 9);
  });

  it("reports its own byte length, which is what a transport limits", () => {
    const out = build("2026-06-15");
    expect(out.bytes).toBe(new TextEncoder().encode(out.message).length);
  });
});

// The chain has to close: what the allocation engine assigned is what goes
// onto the wire, on the same grid, with no reshaping in between.
describe("composition with the allocation engine", () => {
  it("sends exactly what was allocated, on the real grid of the day", () => {
    for (const date of ["2026-06-15", "2026-03-29", "2026-10-25"]) {
      const g = dayGrid(date);
      const profile = illustrativeDayProfile({
        kwp: 30,
        dailyConsumptionKwh: 8,
        participants: 4,
        intervals: g.intervals,
      });
      const shares = illustrativeShares(4);
      const allocation = allocate(
        {
          key: "cascading",
          generationKwh: profile.generationKwh,
          participants: profile.consumptionKwh.map((c, i) => ({
            id: `we-${i + 1}`,
            share: shares[i],
            consumptionKwh: c,
          })),
        },
        { includeSeries: true },
      );

      const out = buildMscons({
        period: { date },
        sender: { code: SENDER },
        receiver: { code: RECEIVER },
        locations: [
          {
            melo: MELO,
            direction: "consumption",
            valuesKwh: allocation.participants[0].series ?? [],
          },
        ],
        preparedAtMs: PREPARED,
      });

      expect(out.grid.intervals).toBe(g.intervals);
      expect(out.totals[0].kwh).toBeCloseTo(allocation.participants[0].allocatedKwh, 6);
      expect(verifyInterchange(out.message).ok).toBe(true);
    }
  });
});
