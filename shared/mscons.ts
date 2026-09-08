/**
 * shared/mscons.ts
 *
 * MSCONS — the message that carries metering values into the market.
 *
 * When a Mieterstrom operator supplies participants, it is a Lieferant, and a
 * Lieferant has to move quarter-hour values between itself, the
 * Messstellenbetreiber, the Netzbetreiber and the Bilanzkreisverantwortlichen.
 * That movement is MSCONS, and it is the boundary between a spreadsheet and a
 * business that can actually operate.
 *
 * The layering here is the point, and it is deliberate:
 *
 *   - The SYNTAX layer (shared/edifact.ts) implements ISO 9735 and is provably
 *     correct: escaping round-trips, segment counts and control references are
 *     computed from content and verified from the outside.
 *   - The TIME layer (shared/market-time.ts) puts every value on the real
 *     local quarter-hour grid, so the two days a year that are not 96
 *     intervals long carry the right number of values.
 *   - The PROFILE layer — which segments a given market role expects, in which
 *     order, with which qualifiers — is a published format description that
 *     changes on a fixed release cycle. It is registered below with its own
 *     `verified` flag, and while that flag is false the builder marks its
 *     output as not ready for productive exchange. The syntax being right does
 *     not make the profile right, and saying otherwise would be the single
 *     most expensive kind of wrong in this market.
 */

import {
  buildInterchange,
  type MessageBody,
  type Segment,
} from "./edifact.js";
import {
  dayGrid,
  edifact102,
  edifact203,
  edifact303,
  rangeGrid,
  type DayGrid,
} from "./market-time.js";
import { validateMessageIdentifiers } from "./market-ids.js";

// ============================================================================
// PROFILE REGISTER
// ============================================================================

export type MessageProfile = {
  id: string;
  messageType: string;
  /** Controlling agency directory, e.g. D 04B UN. */
  directory: { version: string; release: string; agency: string };
  /** Association assigned code — the German market's own subset. */
  associationCode: string;
  /** Has the segment usage been checked against the current format description? */
  verified: boolean;
  reference: string | null;
  asOf: string | null;
  openQuestion?: string;
};

export const MSCONS_PROFILE: MessageProfile = {
  id: "mscons_de",
  messageType: "MSCONS",
  directory: { version: "D", release: "04B", agency: "UN" },
  associationCode: "2.4c",
  verified: false,
  reference: null,
  asOf: null,
  openQuestion:
    "Segmentverwendung, Qualifier und Verzeichnisstand sind nicht gegen die aktuelle Formatbeschreibung des BDEW geprüft. Bis dahin ist die erzeugte Nachricht für Test- und Abstimmungszwecke bestimmt.",
};

export const MSCONS_READINESS_NOTE_DE =
  "Die Syntax dieser Nachricht ist geprüft: Freigabezeichen, Segmentzählung und Kontrollreferenzen werden aus dem Inhalt berechnet und unabhängig nachgeprüft. Die Segmentverwendung folgt einer noch nicht verifizierten Profilfassung; vor dem produktiven Austausch ist sie gegen die geltende Formatbeschreibung abzugleichen.";

// ============================================================================
// OBIS
// ============================================================================

/**
 * The OBIS codes this module knows how to emit.
 *
 * An OBIS code says what was measured. Choosing the wrong one is not a
 * rounding error — it files consumption as generation.
 */
export const OBIS = {
  /** Wirkarbeit Bezug, Zählerstandsgang (load profile, consumption). */
  consumptionInterval: "1-1:1.29.0",
  /** Wirkarbeit Lieferung, Zählerstandsgang (load profile, feed-in). */
  feedInInterval: "1-1:2.29.0",
  /** Wirkarbeit Bezug, Zählerstand (register reading, consumption). */
  consumptionRegister: "1-1:1.8.0",
  /** Wirkarbeit Lieferung, Zählerstand (register reading, feed-in). */
  feedInRegister: "1-1:2.8.0",
} as const;

export type ObisCode = (typeof OBIS)[keyof typeof OBIS];

export type MeasurementDirection = "consumption" | "feed_in";

export function obisForInterval(direction: MeasurementDirection): ObisCode {
  return direction === "consumption" ? OBIS.consumptionInterval : OBIS.feedInInterval;
}

// ============================================================================
// INPUT
// ============================================================================

export type MsconsLocation = {
  /** Messlokation (Zählpunktbezeichnung) the values belong to. */
  melo: string;
  /** Marktlokation, where the values are settled. */
  malo?: string;
  direction: MeasurementDirection;
  /**
   * Quarter-hour values in kWh, aligned to the grid of the stated day or
   * range. Length is checked against the grid, not assumed.
   */
  valuesKwh: number[];
  /**
   * Status per value. Absent means measured. This is what separates a real
   * implementation from a demo: substituted values must be marked, because
   * settlement treats them differently.
   */
  statuses?: ValueStatus[];
};

/** Measured, substituted, or estimated. */
export type ValueStatus = "measured" | "substituted" | "estimated";

/** Qualifier written for each status. */
const STATUS_QUALIFIER: Record<ValueStatus, string> = {
  measured: "220",
  substituted: "67",
  estimated: "79",
};

export type MsconsInput = {
  /** Local date, or a half-open local date range. */
  period: { date: string } | { from: string; to: string };
  sender: { code: string; qualifier?: string };
  receiver: { code: string; qualifier?: string };
  locations: MsconsLocation[];
  /** Interchange control reference. Generated when omitted. */
  controlReference?: string;
  /** Message reference. Generated when omitted. */
  messageReference?: string;
  /** Instant the message is prepared. Injectable so output is reproducible. */
  preparedAtMs?: number;
  /** Mark the interchange as a test. Defaults to true while the profile is unverified. */
  test?: boolean;
};

export class MsconsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MsconsError";
    this.code = code;
  }
}

export type MsconsResult = {
  /** The complete interchange, ready to hand to a transport. */
  message: string;
  /** Byte length as UTF-8, which is what a transport limit applies to. */
  bytes: number;
  controlReference: string;
  messageReference: string;
  /** The grid the values were placed on, including any short or long day. */
  grid: { intervals: number; from: string; to: string; dstDays: { date: string; intervals: number }[] };
  /** Total energy per location, so the message can be reconciled at a glance. */
  totals: { melo: string; direction: MeasurementDirection; kwh: number; values: number }[];
  profile: MessageProfile;
  /** Non-fatal notes, including the readiness of the profile. */
  warnings: { code: string; message: string }[];
};

// ============================================================================
// BUILDER
// ============================================================================

function gridFor(period: MsconsInput["period"]): {
  intervals: number;
  startsUtcMs: number[];
  from: string;
  to: string;
  dstDays: { date: string; intervals: number }[];
  days: DayGrid[];
} {
  if ("date" in period) {
    const g = dayGrid(period.date);
    return {
      intervals: g.intervals,
      startsUtcMs: g.startsUtcMs,
      from: g.date,
      to: g.date,
      dstDays: g.kind === "normal" ? [] : [{ date: g.date, intervals: g.intervals }],
      days: [g],
    };
  }
  const r = rangeGrid(period.from, period.to);
  return {
    intervals: r.intervals,
    startsUtcMs: r.startsUtcMs,
    from: r.from,
    to: r.to,
    dstDays: r.dstDays.map((d) => ({ date: d.date, intervals: d.intervals })),
    days: r.days,
  };
}

/** Deterministic reference from the prepared instant plus a discriminator. */
function reference(prefix: string, preparedAtMs: number, salt: string): string {
  let hash = 0;
  for (const ch of salt) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const stamp = Math.floor(preparedAtMs / 1000).toString(36).toUpperCase();
  return `${prefix}${stamp}${hash.toString(36).toUpperCase().slice(0, 4)}`.slice(0, 14);
}

/**
 * Build an MSCONS interchange from interval values.
 *
 * Every quantity is stamped with the UTC instant of its own interval, taken
 * from the real local grid. The 92-interval and 100-interval days therefore
 * carry 92 and 100 values, and the message is rejected when the supplied
 * series does not match — rather than being padded or truncated to 96, which
 * is how a clock change turns into a wrong invoice.
 */
export function buildMscons(input: MsconsInput): MsconsResult {
  if (input.locations.length === 0) {
    throw new MsconsError("no_locations", "Es wurde keine Messlokation übergeben.");
  }

  const grid = gridFor(input.period);
  const preparedAtMs = input.preparedAtMs ?? Date.now();
  const warnings: { code: string; message: string }[] = [];

  // Identifiers first: a malformed one is rejected days later by a system that
  // explains nothing, so it is caught here.
  const ids = validateMessageIdentifiers({
    senderCode: input.sender.code,
    receiverCode: input.receiver.code,
    malo: input.locations.find((l) => l.malo)?.malo,
    melo: input.locations[0]?.melo,
  });
  if (!ids.ok) {
    throw new MsconsError("invalid_identifiers", ids.problems.join(" "));
  }

  const seenMelo = new Set<string>();
  for (const loc of input.locations) {
    const key = `${loc.melo}:${loc.direction}`;
    if (seenMelo.has(key)) {
      throw new MsconsError(
        "duplicate_location",
        `Die Messlokation ${loc.melo} kommt für dieselbe Energierichtung mehrfach vor.`,
      );
    }
    seenMelo.add(key);

    if (loc.valuesKwh.length !== grid.intervals) {
      throw new MsconsError(
        "series_length_mismatch",
        `Messlokation ${loc.melo}: ${loc.valuesKwh.length} Werte übergeben, der Zeitraum umfasst ${grid.intervals} Viertelstunden.` +
          (grid.dstDays.length > 0
            ? ` Der Zeitraum enthält eine Zeitumstellung (${grid.dstDays
                .map((d) => `${d.date}: ${d.intervals}`)
                .join(", ")}).`
            : ""),
      );
    }
    if (loc.statuses && loc.statuses.length !== loc.valuesKwh.length) {
      throw new MsconsError(
        "status_length_mismatch",
        `Messlokation ${loc.melo}: Anzahl der Statusangaben passt nicht zur Anzahl der Werte.`,
      );
    }
    for (const v of loc.valuesKwh) {
      if (!Number.isFinite(v) || v < 0) {
        throw new MsconsError("invalid_value", `Messlokation ${loc.melo}: unzulässiger Messwert.`);
      }
    }
  }

  if (grid.dstDays.length > 0) {
    warnings.push({
      code: "dst_day_in_period",
      message: `Der Zeitraum enthält eine Zeitumstellung: ${grid.dstDays
        .map((d) => `${d.date} mit ${d.intervals} Viertelstunden`)
        .join(", ")}. Die Werte wurden auf dieses Raster gestellt.`,
    });
  }

  const controlReference = input.controlReference ?? reference("ET", preparedAtMs, input.sender.code);
  const messageReference = input.messageReference ?? reference("M", preparedAtMs, input.receiver.code);

  const periodStart = grid.startsUtcMs[0];
  const periodEnd = grid.days[grid.days.length - 1].endUtcMs;

  const segments: Segment[] = [];

  // Document identification: metering values, original.
  segments.push({ tag: "BGM", elements: [["7", "", "", "9"], messageReference, "9"] });
  // Message date/time.
  segments.push({ tag: "DTM", elements: [["137", edifact303(preparedAtMs), "303"]] });

  // Parties.
  segments.push({
    tag: "NAD",
    elements: ["MS", [input.sender.code, "", input.sender.qualifier ?? "293"]],
  });
  segments.push({
    tag: "NAD",
    elements: ["MR", [input.receiver.code, "", input.receiver.qualifier ?? "293"]],
  });

  // Detail section.
  segments.push({ tag: "UNS", elements: ["D"] });

  for (const loc of input.locations) {
    segments.push({ tag: "NAD", elements: ["DP"] });
    segments.push({ tag: "LOC", elements: ["172", [loc.melo, "", "89"]] });
    if (loc.malo) {
      segments.push({ tag: "RFF", elements: [["Z18", loc.malo]] });
    }

    // Reporting period for this location.
    segments.push({
      tag: "DTM",
      elements: [["163", edifact303(periodStart), "303"]],
    });
    segments.push({ tag: "DTM", elements: [["164", edifact303(periodEnd), "303"]] });

    const obis = obisForInterval(loc.direction);

    let line = 0;
    for (let i = 0; i < loc.valuesKwh.length; i++) {
      const value = loc.valuesKwh[i];
      const status = loc.statuses?.[i] ?? "measured";
      const intervalStart = grid.startsUtcMs[i];
      const intervalEnd = intervalStart + 15 * 60_000;

      line++;
      segments.push({ tag: "LIN", elements: [String(line)] });
      segments.push({ tag: "PIA", elements: ["5", [obis, "SRW"]] });
      segments.push({
        tag: "QTY",
        elements: [[STATUS_QUALIFIER[status], round3(value), "KWH"]],
      });
      // Interval boundaries. A value belongs to the quarter-hour that ENDS at
      // 164; stating both removes the ambiguity that costs reconciliations.
      segments.push({ tag: "DTM", elements: [["163", edifact303(intervalStart), "303"]] });
      segments.push({ tag: "DTM", elements: [["164", edifact303(intervalEnd), "303"]] });
    }
  }

  const body: MessageBody = {
    reference: messageReference,
    identifier: [
      MSCONS_PROFILE.messageType,
      MSCONS_PROFILE.directory.version,
      MSCONS_PROFILE.directory.release,
      MSCONS_PROFILE.directory.agency,
      MSCONS_PROFILE.associationCode,
    ],
    segments,
  };

  const isTest = input.test ?? !MSCONS_PROFILE.verified;
  if (isTest) {
    warnings.push({
      code: "profile_unverified",
      message: MSCONS_READINESS_NOTE_DE,
    });
  }

  const message = buildInterchange(
    {
      sender: { id: input.sender.code, qualifier: input.sender.qualifier ?? "500" },
      receiver: { id: input.receiver.code, qualifier: input.receiver.qualifier ?? "500" },
      preparedAt: { date: edifact102(preparedAtMs).slice(2), time: edifact203(preparedAtMs).slice(8) },
      controlReference,
      applicationReference: MSCONS_PROFILE.messageType,
      testIndicator: isTest,
    },
    [body],
  );

  return {
    message,
    bytes: new TextEncoder().encode(message).length,
    controlReference,
    messageReference,
    grid: { intervals: grid.intervals, from: grid.from, to: grid.to, dstDays: grid.dstDays },
    totals: input.locations.map((l) => ({
      melo: l.melo,
      direction: l.direction,
      kwh: l.valuesKwh.reduce((s, v) => s + v, 0),
      values: l.valuesKwh.length,
    })),
    profile: MSCONS_PROFILE,
    warnings,
  };
}

/** Three decimals is the resolution settlement uses for kWh. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
