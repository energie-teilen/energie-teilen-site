/**
 * shared/allocation.ts
 *
 * Aufteilungsschlüssel: distributes generated energy across participants over
 * fifteen-minute intervals.
 *
 * A metering concept says which values get measured. This says what happens to
 * them. Every participation model that involves more than one offtaker needs a
 * rule for splitting each interval's generation, and that rule has to hold two
 * properties at once: no participant may be allocated more than they actually
 * consumed in that interval, and no kilowatt-hour may be allocated twice.
 * Everything not allocated is fed into the grid.
 *
 * The engine is exact. Allocation plus feed-in equals generation in every
 * interval, by construction rather than by rounding, and the invariant is
 * pinned by test.
 *
 * Three keys are implemented, and the difference between them is money:
 *
 *   - static      — fixed shares. Simple to agree, leaves energy unused when a
 *                   participant's share exceeds their demand in an interval.
 *   - dynamic     — pro rata by actual consumption in the interval. Every
 *                   participant gets the same coverage ratio.
 *   - cascading   — fixed shares, then the unused remainder is redistributed
 *                   pro rata among participants who still have unmet demand,
 *                   repeatedly, until nothing more can be placed. Maximises
 *                   self-consumption while keeping the agreed shares as the
 *                   first claim.
 *
 * The engine computes. It does not assert which key is legally permissible in
 * a given constellation; that is stated in the disclaimer and left to review.
 */

import { z } from "zod";
import { INTERVALS_NORMAL_DAY, INTERVAL_MINUTES as MARKET_INTERVAL_MINUTES } from "./market-time.js";

// ============================================================================
// TIME BASE
// ============================================================================

/**
 * Settlement resolution, taken from the market time base so there is one
 * source of truth. INTERVALS_PER_DAY is the ORDINARY day only: two days a
 * year have 92 and 100 intervals, and anything that needs the real count for
 * a specific date asks shared/market-time.ts for that day's grid.
 */
export const INTERVAL_MINUTES = MARKET_INTERVAL_MINUTES;
export const INTERVALS_PER_HOUR = 60 / INTERVAL_MINUTES;
export const INTERVALS_PER_DAY = INTERVALS_NORMAL_DAY;

/** Bounded so a single request cannot be turned into an unbounded computation. */
export const MAX_INTERVALS = 35_040; // one non-leap year at 15 minutes
export const MAX_PARTICIPANTS = 500;

// ============================================================================
// INPUT
// ============================================================================

export const AllocationKeySchema = z.enum(["static", "dynamic", "cascading"]);
export type AllocationKey = z.infer<typeof AllocationKeySchema>;

export const KEY_LABEL_DE: Record<AllocationKey, string> = {
  static: "Statischer Schlüssel (feste Anteile)",
  dynamic: "Dynamischer Schlüssel (verbrauchsanteilig je Viertelstunde)",
  cascading: "Statischer Schlüssel mit Nachverteilung des Rests",
};

export const KEY_DESCRIPTION_DE: Record<AllocationKey, string> = {
  static:
    "Jeder Teilnehmer erhält in jeder Viertelstunde höchstens seinen festen Anteil an der Erzeugung. Was ein Teilnehmer nicht abnimmt, verfällt für die Zuordnung und wird eingespeist.",
  dynamic:
    "Die Erzeugung wird in jeder Viertelstunde im Verhältnis der tatsächlichen Verbräuche verteilt. Alle Teilnehmer erreichen denselben Deckungsgrad.",
  cascading:
    "Zunächst gilt der feste Anteil. Der davon nicht genutzte Rest wird anschließend verbrauchsanteilig unter den Teilnehmern mit offenem Bedarf weiterverteilt, bis nichts mehr zugeordnet werden kann.",
};

export const ParticipantSchema = z.object({
  /** Stable identifier supplied by the caller. Echoed in the result. */
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120).optional(),
  /**
   * Fixed share for the static and cascading keys, as a fraction of generation.
   * Ignored by the dynamic key. Shares across all participants must not exceed
   * 1; a shortfall is permitted and is reported.
   */
  share: z.number().min(0).max(1).optional(),
  /** Consumption per interval in kWh. Length must match the generation series. */
  consumptionKwh: z.array(z.number().min(0)),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const AllocationInputSchema = z.object({
  key: AllocationKeySchema,
  /** Generation per interval in kWh, at the plant's generation meter. */
  generationKwh: z.array(z.number().min(0)).min(1).max(MAX_INTERVALS),
  participants: z.array(ParticipantSchema).min(1).max(MAX_PARTICIPANTS),
});
export type AllocationInput = z.infer<typeof AllocationInputSchema>;

// ============================================================================
// OUTPUT
// ============================================================================

export type ParticipantAllocation = {
  id: string;
  label: string | null;
  /** Agreed share, or null for a key that does not use one. */
  share: number | null;
  consumptionKwh: number;
  /** Energy from the shared plant. Never exceeds consumption. */
  allocatedKwh: number;
  /** Consumption the plant did not cover; drawn from the grid. */
  gridDrawKwh: number;
  /** allocated / consumption. Null when the participant consumed nothing. */
  coverageRate: number | null;
  /** Per-interval allocation, present only when requested. */
  series: number[] | null;
};

export type AllocationTotals = {
  generationKwh: number;
  consumptionKwh: number;
  allocatedKwh: number;
  /** Generation that found no participant with unmet demand. */
  feedInKwh: number;
  gridDrawKwh: number;
  /** allocated / generation — the share of output that stayed in the group. */
  selfConsumptionRate: number;
  /** allocated / consumption — the share of demand the plant covered. */
  autarkyRate: number;
  intervals: number;
  intervalMinutes: number;
};

export type AllocationResult = {
  key: AllocationKey;
  keyLabel: string;
  keyDescription: string;
  participants: ParticipantAllocation[];
  totals: AllocationTotals;
  /** Per-interval totals, present only when requested. */
  generationSeries: number[] | null;
  feedInSeries: number[] | null;
  warnings: { code: string; message: string }[];
  disclaimer: string;
};

export const ALLOCATION_DISCLAIMER_DE =
  "Rechnerische Zuordnung auf Basis der übergebenen Messwerte. Welcher Aufteilungsschlüssel im konkreten Fall vereinbart und dem Netzbetreiber gemeldet werden kann, ist gesondert zu prüfen.";

export const ILLUSTRATIVE_PROFILE_DISCLAIMER_DE =
  "Beispielprofil zur Veranschaulichung des Verfahrens. Es handelt sich nicht um Messwerte; für eine belastbare Zuordnung sind Lastgänge der Messstellen erforderlich.";

// ============================================================================
// ERRORS
// ============================================================================

export class AllocationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AllocationError";
    this.code = code;
  }
}

/** Shares may under-run (the remainder is simply fed in) but never over-run. */
export const SHARE_SUM_TOLERANCE = 1e-9;

// ============================================================================
// ENGINE
// ============================================================================

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

/**
 * Distribute one interval's generation.
 *
 * Returns per-participant allocation for that interval. Guarantees:
 *   - allocation[i] <= demand[i]
 *   - sum(allocation) <= generation
 * Both are enforced structurally, not by clamping after the fact.
 */
function allocateInterval(
  key: AllocationKey,
  generation: number,
  demand: number[],
  shares: number[],
): number[] {
  const n = demand.length;
  const out = zeros(n);
  if (generation <= 0) return out;

  if (key === "dynamic") {
    const totalDemand = demand.reduce((s, d) => s + d, 0);
    if (totalDemand <= 0) return out;
    if (generation >= totalDemand) {
      for (let i = 0; i < n; i++) out[i] = demand[i];
      return out;
    }
    for (let i = 0; i < n; i++) out[i] = (generation * demand[i]) / totalDemand;
    return out;
  }

  // static and cascading both start from the agreed shares.
  for (let i = 0; i < n; i++) {
    out[i] = Math.min(demand[i], generation * shares[i]);
  }
  if (key === "static") return out;

  // Cascading: place the remainder among participants who still have demand,
  // pro rata to what they are still short of, until nothing moves. Each pass
  // strictly reduces either the remainder or the number of unsatisfied
  // participants, so the loop terminates; the bound is a guard, not the logic.
  let placed = out.reduce((s, v) => s + v, 0);
  let remainder = generation - placed;

  for (let pass = 0; pass < n + 1 && remainder > 1e-12; pass++) {
    const unmet: number[] = zeros(n);
    let unmetTotal = 0;
    for (let i = 0; i < n; i++) {
      const gap = demand[i] - out[i];
      if (gap > 1e-12) {
        unmet[i] = gap;
        unmetTotal += gap;
      }
    }
    if (unmetTotal <= 0) break;

    const toPlace = Math.min(remainder, unmetTotal);
    for (let i = 0; i < n; i++) {
      if (unmet[i] <= 0) continue;
      out[i] += (toPlace * unmet[i]) / unmetTotal;
    }
    remainder -= toPlace;
  }

  return out;
}

function validate(input: AllocationInput): { shares: number[]; warnings: { code: string; message: string }[] } {
  const warnings: { code: string; message: string }[] = [];
  const intervals = input.generationKwh.length;

  for (const p of input.participants) {
    if (p.consumptionKwh.length !== intervals) {
      throw new AllocationError(
        "series_length_mismatch",
        `Teilnehmer "${p.id}": ${p.consumptionKwh.length} Messwerte, erwartet ${intervals} passend zur Erzeugungsreihe.`,
      );
    }
  }

  const ids = new Set<string>();
  for (const p of input.participants) {
    if (ids.has(p.id)) {
      throw new AllocationError("duplicate_participant", `Teilnehmer-ID "${p.id}" kommt mehrfach vor.`);
    }
    ids.add(p.id);
  }

  const usesShares = input.key === "static" || input.key === "cascading";
  const declared = input.participants.filter((p) => p.share !== undefined).length;

  let shares: number[];
  if (!usesShares) {
    shares = input.participants.map(() => 0);
  } else if (declared === 0) {
    // No shares given: an equal split is the only neutral reading, and it is
    // reported so the caller can see it was not their choice.
    const equal = 1 / input.participants.length;
    shares = input.participants.map(() => equal);
    warnings.push({
      code: "shares_defaulted_equal",
      message: `Keine Anteile übergeben. Es wurde gleichmäßig auf ${input.participants.length} Teilnehmer verteilt (je ${(equal * 100).toFixed(2)} %).`,
    });
  } else {
    if (declared !== input.participants.length) {
      throw new AllocationError(
        "partial_shares",
        "Anteile müssen für alle Teilnehmer oder für keinen angegeben werden.",
      );
    }
    shares = input.participants.map((p) => p.share ?? 0);
    const sum = shares.reduce((s, v) => s + v, 0);
    if (sum > 1 + SHARE_SUM_TOLERANCE) {
      throw new AllocationError(
        "shares_exceed_one",
        `Die Summe der Anteile beträgt ${(sum * 100).toFixed(2)} % und überschreitet 100 %.`,
      );
    }
    if (sum < 1 - 1e-6) {
      warnings.push({
        code: "shares_below_one",
        message: `Die Anteile summieren sich auf ${(sum * 100).toFixed(2)} %. Der nicht zugeteilte Rest wird eingespeist.`,
      });
    }
  }

  return { shares, warnings };
}

export type AllocationOptions = {
  /** Return the per-interval series as well as the totals. */
  includeSeries?: boolean;
};

/**
 * Run the allocation.
 *
 * Deterministic. Feed-in is derived as generation minus what was allocated, so
 * the energy balance closes exactly rather than approximately.
 */
export function allocate(input: AllocationInput, options: AllocationOptions = {}): AllocationResult {
  const { shares, warnings } = validate(input);
  const intervals = input.generationKwh.length;
  const n = input.participants.length;

  const allocatedTotals = zeros(n);
  const series: number[][] = options.includeSeries ? input.participants.map(() => zeros(intervals)) : [];
  const feedInSeries = options.includeSeries ? zeros(intervals) : null;

  let totalGeneration = 0;
  let totalAllocated = 0;

  const demand = zeros(n);

  for (let t = 0; t < intervals; t++) {
    const generation = input.generationKwh[t];
    for (let i = 0; i < n; i++) demand[i] = input.participants[i].consumptionKwh[t];

    const step = allocateInterval(input.key, generation, demand, shares);

    let stepTotal = 0;
    for (let i = 0; i < n; i++) {
      allocatedTotals[i] += step[i];
      stepTotal += step[i];
      if (options.includeSeries) series[i][t] = step[i];
    }

    totalGeneration += generation;
    totalAllocated += stepTotal;
    if (feedInSeries) feedInSeries[t] = generation - stepTotal;
  }

  const participants: ParticipantAllocation[] = input.participants.map((p, i) => {
    const consumption = p.consumptionKwh.reduce((s, v) => s + v, 0);
    const allocated = allocatedTotals[i];
    return {
      id: p.id,
      label: p.label ?? null,
      share: input.key === "dynamic" ? null : shares[i],
      consumptionKwh: consumption,
      allocatedKwh: allocated,
      gridDrawKwh: consumption - allocated,
      coverageRate: consumption > 0 ? allocated / consumption : null,
      series: options.includeSeries ? series[i] : null,
    };
  });

  const totalConsumption = participants.reduce((s, p) => s + p.consumptionKwh, 0);

  if (input.key === "static") {
    const unusedShare = participants.filter((p) => p.share !== null && p.coverageRate !== null && p.coverageRate >= 0.999);
    if (unusedShare.length > 0 && totalGeneration - totalAllocated > 0) {
      warnings.push({
        code: "static_key_leaves_energy",
        message: `${unusedShare.length} Teilnehmer sind vollständig gedeckt, während ${(totalGeneration - totalAllocated).toFixed(1)} kWh eingespeist werden. Ein Schlüssel mit Nachverteilung würde die Eigennutzung erhöhen.`,
      });
    }
  }

  if (totalGeneration <= 0) {
    warnings.push({
      code: "no_generation",
      message: "Die übergebene Erzeugungsreihe enthält ausschließlich Nullwerte.",
    });
  }

  return {
    key: input.key,
    keyLabel: KEY_LABEL_DE[input.key],
    keyDescription: KEY_DESCRIPTION_DE[input.key],
    participants,
    totals: {
      generationKwh: totalGeneration,
      consumptionKwh: totalConsumption,
      allocatedKwh: totalAllocated,
      feedInKwh: totalGeneration - totalAllocated,
      gridDrawKwh: totalConsumption - totalAllocated,
      selfConsumptionRate: totalGeneration > 0 ? totalAllocated / totalGeneration : 0,
      autarkyRate: totalConsumption > 0 ? totalAllocated / totalConsumption : 0,
      intervals,
      intervalMinutes: INTERVAL_MINUTES,
    },
    generationSeries: options.includeSeries ? [...input.generationKwh] : null,
    feedInSeries,
    warnings,
    disclaimer: ALLOCATION_DISCLAIMER_DE,
  };
}

/**
 * Run every key against the same data.
 *
 * The comparison is the point: the difference in self-consumption between a
 * static and a cascading key is a number a customer can act on, and it can only
 * be produced by computing both.
 */
export function compareKeys(
  input: Omit<AllocationInput, "key">,
  options: AllocationOptions = {},
): Record<AllocationKey, AllocationResult> {
  return {
    static: allocate({ ...input, key: "static" }, options),
    dynamic: allocate({ ...input, key: "dynamic" }, options),
    cascading: allocate({ ...input, key: "cascading" }, options),
  };
}

// ============================================================================
// ILLUSTRATIVE PROFILES
// ============================================================================

/**
 * A deterministic day profile for demonstrating the mechanism.
 *
 * Explicitly not measurement: every consumer of this is required to carry
 * ILLUSTRATIVE_PROFILE_DISCLAIMER_DE. It exists so the allocation can be shown
 * working before a customer has supplied a single meter reading.
 *
 * Generation follows a clipped cosine centred on solar noon; household demand
 * follows a fixed two-peak shape. No randomness — the same arguments always
 * produce the same series.
 */
export function illustrativeShares(participants: number): number[] {
  // Agreed shares in practice follow ownership or floor area, which is not the
  // same ordering as consumption. The mismatch is deliberate: with shares that
  // happen to track demand, every key produces the same answer and the choice
  // looks like it does not matter.
  const raw = Array.from({ length: participants }, (_, i) => 1 + ((i % 4) - 1.5) * 0.3);
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map((v) => v / sum);
}

export function illustrativeDayProfile(options: {
  kwp: number;
  /** Daily consumption per participant in kWh. */
  dailyConsumptionKwh: number;
  participants: number;
  /** Peak-sun equivalent hours for the modelled day. */
  peakSunHours?: number;
  /**
   * Length of the day being modelled. Pass the real count from
   * shared/market-time.ts when the day is a clock-change day: on those the
   * profile must be 92 or 100 values long, not 96.
   */
  intervals?: number;
}): { generationKwh: number[]; consumptionKwh: number[][] } {
  const { kwp, dailyConsumptionKwh, participants } = options;
  const peakSunHours = options.peakSunHours ?? 3.5;
  const n = options.intervals ?? INTERVALS_PER_DAY;

  // Generation: raised cosine over a 12-hour window centred on solar noon.
  const raw = zeros(n);
  const halfWindow = 6 * INTERVALS_PER_HOUR;
  for (let t = 0; t < n; t++) {
    const offset = t - n / 2;
    if (Math.abs(offset) >= halfWindow) continue;
    raw[t] = 0.5 * (1 + Math.cos((Math.PI * offset) / halfWindow));
  }
  const rawSum = raw.reduce((s, v) => s + v, 0);
  const dailyYield = kwp * peakSunHours;
  const generationKwh = raw.map((v) => (rawSum > 0 ? (v / rawSum) * dailyYield : 0));

  // Demand: a fixed residential shape, morning and evening peaks over a base
  // load. Each participant's shape is shifted by a fixed, index-derived offset
  // so the profiles differ from one another — without that the allocation keys
  // would be indistinguishable, which would misrepresent what they do.
  const consumptionKwh: number[][] = [];
  for (let p = 0; p < participants; p++) {
    const shiftHours = ((p % 5) - 2) * 0.75;
    const scale = 1 + ((p % 3) - 1) * 0.2;
    const shape = zeros(n);
    for (let t = 0; t < n; t++) {
      const hour = t / INTERVALS_PER_HOUR - shiftHours;
      const base = 0.35;
      const morning = 0.9 * Math.exp(-Math.pow(hour - 7.5, 2) / 2.5);
      const evening = 1.3 * Math.exp(-Math.pow(hour - 19.5, 2) / 4.0);
      shape[t] = base + morning + evening;
    }
    const shapeSum = shape.reduce((s, v) => s + v, 0);
    const total = dailyConsumptionKwh * scale;
    consumptionKwh.push(shape.map((v) => (shapeSum > 0 ? (v / shapeSum) * total : 0)));
  }

  return { generationKwh, consumptionKwh };
}
