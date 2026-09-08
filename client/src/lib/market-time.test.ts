import { describe, it, expect } from "vitest";
import {
  INTERVALS_LONG_DAY,
  INTERVALS_NORMAL_DAY,
  INTERVALS_SHORT_DAY,
  INTERVAL_MS,
  MARKET_TIMEZONE,
  MarketTimeError,
  dayGrid,
  edifact102,
  edifact203,
  edifact303,
  intervalLabel,
  isSummerTime,
  localDateOf,
  localToUtc,
  nextLocalDate,
  rangeGrid,
  startOfLocalDay,
  utcOffsetMs,
  wallClock,
} from "../../../shared/market-time";

describe("timezone base", () => {
  it("uses the market's reference timezone", () => {
    expect(MARKET_TIMEZONE).toBe("Europe/Berlin");
  });

  it("reports one hour in winter and two in summer", () => {
    expect(utcOffsetMs(Date.parse("2026-01-15T12:00:00Z"))).toBe(3_600_000);
    expect(utcOffsetMs(Date.parse("2026-07-15T12:00:00Z"))).toBe(7_200_000);
    expect(isSummerTime(Date.parse("2026-01-15T12:00:00Z"))).toBe(false);
    expect(isSummerTime(Date.parse("2026-07-15T12:00:00Z"))).toBe(true);
  });

  it("switches at the instant the clocks change, not at midnight", () => {
    // 2026-03-29 01:00 UTC is 02:00 local, the moment the clock jumps to 03:00.
    expect(utcOffsetMs(Date.parse("2026-03-29T00:59:59Z"))).toBe(3_600_000);
    expect(utcOffsetMs(Date.parse("2026-03-29T01:00:00Z"))).toBe(7_200_000);
    expect(utcOffsetMs(Date.parse("2026-10-25T00:59:59Z"))).toBe(7_200_000);
    expect(utcOffsetMs(Date.parse("2026-10-25T01:00:00Z"))).toBe(3_600_000);
  });

  it("reads the local wall clock rather than the UTC one", () => {
    const w = wallClock(Date.parse("2026-07-15T22:30:00Z"));
    expect(w).toMatchObject({ year: 2026, month: 7, day: 16, hour: 0, minute: 30 });
  });

  it("names the local date, which can differ from the UTC date", () => {
    expect(localDateOf(Date.parse("2026-07-15T22:30:00Z"))).toBe("2026-07-16");
    expect(localDateOf(Date.parse("2026-01-15T22:30:00Z"))).toBe("2026-01-15");
  });

  it("round-trips local midnight through UTC", () => {
    for (const date of ["2026-01-01", "2026-03-29", "2026-06-15", "2026-10-25", "2026-12-31"]) {
      expect(localDateOf(startOfLocalDay(date))).toBe(date);
      expect(wallClock(startOfLocalDay(date)).hour).toBe(0);
      expect(wallClock(startOfLocalDay(date)).minute).toBe(0);
    }
  });

  it("advances across month and year ends", () => {
    expect(nextLocalDate("2026-01-31")).toBe("2026-02-01");
    expect(nextLocalDate("2026-12-31")).toBe("2027-01-01");
    expect(nextLocalDate("2024-02-28")).toBe("2024-02-29");
    expect(nextLocalDate("2026-02-28")).toBe("2026-03-01");
  });

  it("rejects a malformed date instead of guessing", () => {
    expect(() => startOfLocalDay("29.03.2026")).toThrow(MarketTimeError);
    expect(() => startOfLocalDay("2026-13-01")).toThrow(MarketTimeError);
  });

  // The hour skipped in spring does not exist; the conversion has to land
  // somewhere defined rather than silently producing the previous hour.
  it("resolves a non-existent local time to the instant the clock jumps to", () => {
    const utc = localToUtc(2026, 3, 29, 2, 30);
    expect(wallClock(utc).hour).toBe(3);
  });
});

describe("day grid", () => {
  it("gives an ordinary day 96 quarter-hours", () => {
    const g = dayGrid("2026-06-15");
    expect(g.intervals).toBe(INTERVALS_NORMAL_DAY);
    expect(g.kind).toBe("normal");
    expect(g.startsUtcMs).toHaveLength(96);
  });

  // The whole reason this module exists.
  it("gives the spring clock-change day 92 quarter-hours", () => {
    for (const date of ["2026-03-29", "2027-03-28", "2024-03-31", "2025-03-30"]) {
      const g = dayGrid(date);
      expect(g.intervals).toBe(INTERVALS_SHORT_DAY);
      expect(g.kind).toBe("dst_short");
    }
  });

  it("gives the autumn clock-change day 100 quarter-hours", () => {
    for (const date of ["2026-10-25", "2027-10-31", "2024-10-27", "2025-10-26"]) {
      const g = dayGrid(date);
      expect(g.intervals).toBe(INTERVALS_LONG_DAY);
      expect(g.kind).toBe("dst_long");
    }
  });

  it("derives the interval count from the calendar rather than assuming it", () => {
    for (const date of ["2026-03-29", "2026-06-15", "2026-10-25"]) {
      const g = dayGrid(date);
      expect(g.endUtcMs - g.startUtcMs).toBe(g.intervals * INTERVAL_MS);
    }
  });

  it("spaces every interval exactly fifteen minutes apart in real time", () => {
    for (const date of ["2026-03-29", "2026-10-25"]) {
      const g = dayGrid(date);
      for (let i = 1; i < g.intervals; i++) {
        expect(g.startsUtcMs[i] - g.startsUtcMs[i - 1]).toBe(INTERVAL_MS);
      }
    }
  });

  it("starts and ends each day at local midnight", () => {
    const g = dayGrid("2026-10-25");
    expect(wallClock(g.startUtcMs).hour).toBe(0);
    expect(wallClock(g.endUtcMs).hour).toBe(0);
    expect(localDateOf(g.endUtcMs)).toBe("2026-10-26");
  });
});

describe("interval labels", () => {
  it("labels an ordinary day with plain wall-clock times", () => {
    const g = dayGrid("2026-06-15");
    expect(intervalLabel(g, 0)).toBe("00:00");
    expect(intervalLabel(g, 1)).toBe("00:15");
    expect(intervalLabel(g, 95)).toBe("23:45");
  });

  it("skips the hour that does not exist in spring", () => {
    const g = dayGrid("2026-03-29");
    expect(intervalLabel(g, 7)).toBe("01:45");
    expect(intervalLabel(g, 8)).toBe("03:00");
  });

  // Two different quarter-hours read 02:15 on the long day. A human
  // reconciling values has to be able to tell them apart.
  it("distinguishes the repeated hour in autumn", () => {
    const g = dayGrid("2026-10-25");
    const labels = Array.from({ length: g.intervals }, (_, i) => intervalLabel(g, i));
    expect(labels.filter((l) => l.startsWith("02:15"))).toEqual(["02:15A", "02:15B"]);
    expect(new Set(labels).size).toBe(g.intervals);
  });

  // Suffixing every interval would imply the whole day is ambiguous. Only the
  // eight quarter-hours that genuinely occur twice carry a suffix.
  it("suffixes only the intervals that actually repeat", () => {
    const g = dayGrid("2026-10-25");
    const labels = Array.from({ length: g.intervals }, (_, i) => intervalLabel(g, i));
    expect(labels.filter((l) => /[AB]$/.test(l))).toHaveLength(8);
    expect(labels[0]).toBe("00:00");
    expect(labels[4]).toBe("01:00");
    expect(labels[g.intervals - 1]).toBe("23:45");
  });

  it("rejects an index outside the day", () => {
    const g = dayGrid("2026-06-15");
    expect(() => intervalLabel(g, 96)).toThrow(MarketTimeError);
    expect(() => intervalLabel(g, -1)).toThrow(MarketTimeError);
  });
});

describe("range grid", () => {
  it("counts a normal week as seven times 96", () => {
    expect(rangeGrid("2026-06-01", "2026-06-08").intervals).toBe(7 * 96);
  });

  it("counts the spring week four intervals short", () => {
    const r = rangeGrid("2026-03-23", "2026-03-30");
    expect(r.intervals).toBe(7 * 96 - 4);
    expect(r.dstDays).toEqual([{ date: "2026-03-29", intervals: 92, kind: "dst_short" }]);
  });

  it("counts the autumn week four intervals long", () => {
    const r = rangeGrid("2026-10-19", "2026-10-26");
    expect(r.intervals).toBe(7 * 96 + 4);
    expect(r.dstDays).toEqual([{ date: "2026-10-25", intervals: 100, kind: "dst_long" }]);
  });

  /*
   * A full year still totals 35 040 because the two changes cancel. That is
   * the trap: the annual figure looks right while two individual days are
   * wrong, so a year-level check proves nothing and this test says so.
   */
  it("nets out over a full year while both days are still irregular", () => {
    const r = rangeGrid("2026-01-01", "2027-01-01");
    expect(r.intervals).toBe(365 * 96);
    expect(r.dstDays.map((d) => d.intervals)).toEqual([92, 100]);
  });

  it("keeps every interval fifteen minutes apart across a clock change", () => {
    const r = rangeGrid("2026-10-24", "2026-10-27");
    for (let i = 1; i < r.startsUtcMs.length; i++) {
      expect(r.startsUtcMs[i] - r.startsUtcMs[i - 1]).toBe(INTERVAL_MS);
    }
  });

  it("rejects a reversed range", () => {
    expect(() => rangeGrid("2026-06-08", "2026-06-01")).toThrow(MarketTimeError);
  });
});

describe("EDIFACT date formats", () => {
  it("writes format 303 with the offset in force at that instant", () => {
    const g = dayGrid("2026-10-25");
    expect(edifact303(g.startsUtcMs[0])).toBe("202610250000+02");
    expect(edifact303(g.startsUtcMs[g.intervals - 1])).toBe("202610252345+01");
  });

  // The repeated hour is disambiguated by the offset, which is how the market
  // tells the two 02:00 quarter-hours apart on the wire.
  it("distinguishes the repeated hour by its offset", () => {
    const g = dayGrid("2026-10-25");
    const stamps = g.startsUtcMs.map(edifact303).filter((s) => s.startsWith("202610250200"));
    expect(stamps).toEqual(["202610250200+02", "202610250200+01"]);
  });

  it("writes format 102 as the local date and 203 as local date and time", () => {
    const utc = Date.parse("2026-07-15T22:30:00Z");
    expect(edifact102(utc)).toBe("20260716");
    expect(edifact203(utc)).toBe("202607160030");
  });
});
