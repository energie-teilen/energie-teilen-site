/**
 * shared/market-time.ts
 *
 * The German market time base.
 *
 * Every settlement quantity in this market is a quarter-hour value on a LOCAL
 * time grid — Europe/Berlin — and that grid is not 96 intervals long. On the
 * last Sunday in March a day has 92 quarter-hours; on the last Sunday in
 * October it has 100. Two days a year, every engine that hard-codes 96 is
 * wrong: it drops four intervals in spring and double-counts four in autumn,
 * and the error lands in an invoice.
 *
 * This module is the single place that knows that. Everything downstream —
 * allocation series, metering values, message timestamps — is built on the
 * grid it produces rather than on an assumed interval count.
 *
 * No timezone library: the IANA rules come from the platform's own tz database
 * through Intl, so they stay current without a dependency to update.
 */

/** The market's reference timezone. */
export const MARKET_TIMEZONE = "Europe/Berlin";

/** Settlement resolution. */
export const INTERVAL_MINUTES = 15;
export const INTERVAL_MS = INTERVAL_MINUTES * 60_000;

/** Interval counts a local day can have. Anything else is a bug, not a date. */
export const INTERVALS_NORMAL_DAY = 96;
export const INTERVALS_SHORT_DAY = 92;
export const INTERVALS_LONG_DAY = 100;

export class MarketTimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MarketTimeError";
    this.code = code;
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** The wall-clock reading in Europe/Berlin for a UTC instant. */
export function wallClock(utcMs: number): WallClock {
  const parts = partsFormatter.formatToParts(new Date(utcMs));
  const get = (type: string) => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new MarketTimeError("format_failed", "Zeitzonendaten nicht verfügbar.");
    return Number(p.value);
  };
  // Some ICU builds report midnight as hour 24 of the previous day.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * Offset of Europe/Berlin from UTC at a given instant, in milliseconds.
 * +3600000 in winter, +7200000 in summer.
 */
export function utcOffsetMs(utcMs: number): number {
  const w = wallClock(utcMs);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Round to the second: Date.UTC drops the milliseconds we did not read back.
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Is Europe/Berlin on summer time at this instant? */
export function isSummerTime(utcMs: number): boolean {
  return utcOffsetMs(utcMs) === 7_200_000;
}

function parseIsoDate(date: string): { y: number; m: number; d: number } {
  const match = ISO_DATE.exec(date);
  if (!match) {
    throw new MarketTimeError("invalid_date", `Datum im Format JJJJ-MM-TT erwartet, erhalten: "${date}".`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new MarketTimeError("invalid_date", `Kein gültiges Datum: "${date}".`);
  }
  return { y, m, d };
}

/**
 * The UTC instant at which a given local wall-clock time occurs.
 *
 * Converges in two passes: the offset depends on the instant, and the instant
 * depends on the offset. Where the wall time does not exist (the hour skipped
 * in spring) the result is the instant the clock jumps to, and where it occurs
 * twice (autumn) the first occurrence is returned — stated here because those
 * two cases are exactly where naive conversions differ silently.
 */
export function localToUtc(
  y: number,
  m: number,
  d: number,
  hour = 0,
  minute = 0,
): number {
  const naive = Date.UTC(y, m - 1, d, hour, minute, 0);

  // Both offsets Europe/Berlin can be in around this instant. Probing an hour
  // and two hours back covers the transition in either direction.
  const candidates = Array.from(
    new Set([naive - utcOffsetMs(naive - 3_600_000), naive - utcOffsetMs(naive - 7_200_000)]),
  ).sort((a, b) => a - b);

  const matches = candidates.filter((c) => {
    const w = wallClock(c);
    return (
      w.year === y && w.month === m && w.day === d && w.hour === hour && w.minute === minute
    );
  });

  // Ambiguous (the autumn hour occurs twice): the earlier instant, still on
  // summer time, is the first occurrence.
  if (matches.length > 0) return matches[0];

  // Non-existent (the spring hour is skipped): the later candidate lands after
  // the jump, which is the only defined answer.
  return candidates[candidates.length - 1];
}

/** The UTC instant of local midnight beginning the given local date. */
export function startOfLocalDay(date: string): number {
  const { y, m, d } = parseIsoDate(date);
  return localToUtc(y, m, d, 0, 0);
}

/** The local date, as an ISO string, containing a UTC instant. */
export function localDateOf(utcMs: number): string {
  const w = wallClock(utcMs);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** The next local date, handling month and year ends without arithmetic on strings. */
export function nextLocalDate(date: string): string {
  const { y, m, d } = parseIsoDate(date);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(
    next.getUTCDate(),
  ).padStart(2, "0")}`;
}

export type DayGrid = {
  /** The local date this grid covers. */
  date: string;
  /** UTC instant of local midnight starting the day. */
  startUtcMs: number;
  /** UTC instant of local midnight ending the day. */
  endUtcMs: number;
  /** 92, 96 or 100. */
  intervals: number;
  /** Which kind of day this is, and why. */
  kind: "normal" | "dst_short" | "dst_long";
  /** UTC instant each interval begins, length === intervals. */
  startsUtcMs: number[];
};

/**
 * The quarter-hour grid of one local day.
 *
 * The interval count is DERIVED from the elapsed time between the two local
 * midnights, not assumed. That is the whole point: the calendar answers the
 * question, the code does not guess.
 */
export function dayGrid(date: string): DayGrid {
  const startUtcMs = startOfLocalDay(date);
  const endUtcMs = startOfLocalDay(nextLocalDate(date));
  const span = endUtcMs - startUtcMs;

  if (span <= 0 || span % INTERVAL_MS !== 0) {
    throw new MarketTimeError(
      "grid_not_aligned",
      `Der Tag ${date} ergibt keine ganze Zahl von Viertelstunden.`,
    );
  }

  const intervals = span / INTERVAL_MS;
  const kind =
    intervals === INTERVALS_NORMAL_DAY
      ? "normal"
      : intervals === INTERVALS_SHORT_DAY
        ? "dst_short"
        : intervals === INTERVALS_LONG_DAY
          ? "dst_long"
          : null;

  if (kind === null) {
    throw new MarketTimeError(
      "unexpected_interval_count",
      `Der Tag ${date} hat ${intervals} Viertelstunden; erwartet werden 92, 96 oder 100.`,
    );
  }

  const startsUtcMs = new Array<number>(intervals);
  for (let i = 0; i < intervals; i++) startsUtcMs[i] = startUtcMs + i * INTERVAL_MS;

  return { date, startUtcMs, endUtcMs, intervals, kind, startsUtcMs };
}

/**
 * The grid over a half-open local date range [from, to).
 *
 * Built by concatenating day grids, so a range spanning a clock change carries
 * the right number of intervals rather than daysInRange × 96.
 */
export function rangeGrid(from: string, to: string): {
  from: string;
  to: string;
  intervals: number;
  days: DayGrid[];
  startsUtcMs: number[];
  /** Days in the range whose length is not 96. */
  dstDays: { date: string; intervals: number; kind: DayGrid["kind"] }[];
} {
  if (from >= to) {
    throw new MarketTimeError("empty_range", "Der Zeitraum muss mit dem Beginn anfangen.");
  }

  const days: DayGrid[] = [];
  const startsUtcMs: number[] = [];
  let cursor = from;
  // A year of daily grids is 365 iterations; the cap stops a malformed range
  // from becoming an unbounded loop.
  for (let guard = 0; cursor < to && guard < 4000; guard++) {
    const g = dayGrid(cursor);
    days.push(g);
    for (const s of g.startsUtcMs) startsUtcMs.push(s);
    cursor = nextLocalDate(cursor);
  }
  if (cursor < to) {
    throw new MarketTimeError("range_too_long", "Der Zeitraum überschreitet die zulässige Länge.");
  }

  return {
    from,
    to,
    intervals: startsUtcMs.length,
    days,
    startsUtcMs,
    dstDays: days
      .filter((d) => d.kind !== "normal")
      .map((d) => ({ date: d.date, intervals: d.intervals, kind: d.kind })),
  };
}

/**
 * Local wall-clock label for an interval start, e.g. "02:15".
 *
 * On the long October day two intervals carry the same label; the A/B suffix
 * distinguishes the first pass from the second, which is how the repeated hour
 * has to be shown to a human who is reconciling values.
 */
export function intervalLabel(grid: DayGrid, index: number): string {
  if (index < 0 || index >= grid.intervals) {
    throw new MarketTimeError("index_out_of_range", `Index ${index} liegt außerhalb des Tages.`);
  }
  const w = wallClock(grid.startsUtcMs[index]);
  const base = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  if (grid.kind !== "dst_long") return base;

  // Only the hour that actually occurs twice is suffixed. Marking every
  // interval would imply the whole day is ambiguous, which it is not.
  const occurrences: number[] = [];
  for (let i = 0; i < grid.intervals; i++) {
    const x = wallClock(grid.startsUtcMs[i]);
    if (x.hour === w.hour && x.minute === w.minute) occurrences.push(i);
  }
  if (occurrences.length < 2) return base;
  return occurrences[0] === index ? `${base}A` : `${base}B`;
}

/**
 * EDIFACT date/time in format qualifier 303: CCYYMMDDHHMM followed by the
 * offset from UTC in whole hours, e.g. "202603291115+02".
 */
export function edifact303(utcMs: number): string {
  const w = wallClock(utcMs);
  const offsetHours = utcOffsetMs(utcMs) / 3_600_000;
  const sign = offsetHours < 0 ? "-" : "+";
  const abs = String(Math.abs(offsetHours)).padStart(2, "0");
  return (
    `${w.year}${String(w.month).padStart(2, "0")}${String(w.day).padStart(2, "0")}` +
    `${String(w.hour).padStart(2, "0")}${String(w.minute).padStart(2, "0")}${sign}${abs}`
  );
}

/** EDIFACT date/time in format qualifier 102: CCYYMMDD, local date. */
export function edifact102(utcMs: number): string {
  const w = wallClock(utcMs);
  return `${w.year}${String(w.month).padStart(2, "0")}${String(w.day).padStart(2, "0")}`;
}

/** EDIFACT date/time in format qualifier 203: CCYYMMDDHHMM, local time. */
export function edifact203(utcMs: number): string {
  const w = wallClock(utcMs);
  return (
    `${w.year}${String(w.month).padStart(2, "0")}${String(w.day).padStart(2, "0")}` +
    `${String(w.hour).padStart(2, "0")}${String(w.minute).padStart(2, "0")}`
  );
}
