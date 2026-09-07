import { useEffect, useMemo, useState } from "react";
import { Info, Split } from "lucide-react";
import { track } from "@/lib/analytics";
import { AllocationDayChart } from "@/components/AllocationDayChart";
import {
  ILLUSTRATIVE_PROFILE_DISCLAIMER_DE,
  KEY_DESCRIPTION_DE,
  KEY_LABEL_DE,
  compareKeys,
  illustrativeDayProfile,
  illustrativeShares,
  type AllocationKey,
} from "../../../shared/allocation";
import type { MieterstromInputs } from "../../../shared/schema";

/**
 * AllocationPanel
 *
 * The Aufteilungsschlüssel, shown as what it actually is: a decision with a
 * number attached.
 *
 * Three keys run against the same day of fifteen-minute values, and the
 * difference between them — how much generated energy stays with the
 * participants instead of being fed in — is computed, not asserted.
 *
 * The profiles are an illustrative shape, and the panel says so in the same
 * view as the figures. Real interval data replaces them; the engine is the
 * same either way.
 */

const KEY_ORDER: AllocationKey[] = ["static", "dynamic", "cascading"];

const KEY_SHORT: Record<AllocationKey, string> = {
  static: "Statisch",
  dynamic: "Dynamisch",
  cascading: "Mit Nachverteilung",
};

/** Consumption per household for the illustrative day. Stated, not inferred. */
const DAILY_CONSUMPTION_KWH = 8;
const PEAK_SUN_HOURS = 3.5;

function pct(v: number): string {
  return `${(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
}

function kwh(v: number): string {
  return `${v.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kWh`;
}

export function AllocationPanel({ inputs }: { inputs: MieterstromInputs }) {
  const participants = Math.max(2, Math.min(24, Math.round(inputs.anzahlWohneinheiten)));

  const profile = useMemo(
    () =>
      illustrativeDayProfile({
        kwp: inputs.kwp,
        dailyConsumptionKwh: DAILY_CONSUMPTION_KWH,
        participants,
        peakSunHours: PEAK_SUN_HOURS,
      }),
    [inputs.kwp, participants],
  );

  const runs = useMemo(() => {
    const shares = illustrativeShares(participants);
    return compareKeys(
      {
        generationKwh: profile.generationKwh,
        participants: profile.consumptionKwh.map((c, i) => ({
          id: `we-${i + 1}`,
          label: `WE ${i + 1}`,
          share: shares[i],
          consumptionKwh: c,
        })),
      },
      { includeSeries: true },
    );
  }, [profile, participants]);

  const best = useMemo(
    () =>
      KEY_ORDER.reduce((a, b) =>
        runs[b].totals.allocatedKwh > runs[a].totals.allocatedKwh ? b : a,
      ),
    [runs],
  );
  const worst = useMemo(
    () =>
      KEY_ORDER.reduce((a, b) =>
        runs[b].totals.allocatedKwh < runs[a].totals.allocatedKwh ? b : a,
      ),
    [runs],
  );

  const [selected, setSelected] = useState<AllocationKey>("cascading");
  const run = runs[selected];

  const spreadKwh = runs[best].totals.allocatedKwh - runs[worst].totals.allocatedKwh;
  const spreadPoints =
    (runs[best].totals.selfConsumptionRate - runs[worst].totals.selfConsumptionRate) * 100;

  useEffect(() => {
    track("allocation_compared", {
      participants,
      best,
      spread_points: Math.round(spreadPoints * 10) / 10,
    });
  }, [participants, best, spreadPoints]);

  const maxAllocated = Math.max(...KEY_ORDER.map((k) => runs[k].totals.allocatedKwh), 1);

  return (
    <div className="rounded-[28px] border border-border/70 bg-card p-6 sm:p-8">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <Split className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-primary">
              Aufteilungsschlüssel
            </p>
            <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
              Wie der erzeugte Strom auf die Teilnehmer verteilt wird
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">
              Der Schlüssel wird viertelstündlich angewendet. Er entscheidet, wie viel
              der Erzeugung bei den Teilnehmern bleibt statt eingespeist zu werden —
              und das ist ein Betrag, kein Detail.
            </p>
          </div>
        </div>

        {/* The number that makes the choice concrete */}
        <div className="rounded-[20px] border border-primary/25 bg-primary/5 p-5">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Unterschied zwischen bestem und schwächstem Schlüssel
          </p>
          <p className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {spreadPoints.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Prozentpunkte
            Eigennutzung
            <span className="ml-2 text-base font-normal text-muted-foreground">
              ({kwh(spreadKwh)} am Beispieltag)
            </span>
          </p>
          <p className="mt-2 text-sm leading-7 text-foreground/90">
            {KEY_LABEL_DE[best]} statt {KEY_SHORT[worst].toLowerCase()} — bei{" "}
            {participants} Teilnehmern und {inputs.kwp} kWp. Jede Kilowattstunde, die
            zugeordnet statt eingespeist wird, wird zum Mieterstrompreis statt zur
            Einspeisevergütung abgerechnet.
          </p>
        </div>

        {/* Key selection */}
        <div className="grid gap-2.5 sm:grid-cols-3">
          {KEY_ORDER.map((k) => {
            const active = selected === k;
            const totals = runs[k].totals;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSelected(k)}
                aria-pressed={active}
                className={`rounded-2xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 bg-background/60 hover:border-border"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{KEY_SHORT[k]}</span>
                  {k === best ? (
                    <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[0.65rem] font-semibold text-primary">
                      höchste Eigennutzung
                    </span>
                  ) : null}
                </span>
                <span className="mt-2 block font-display text-lg font-semibold tabular-nums text-foreground">
                  {pct(totals.selfConsumptionRate)}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {kwh(totals.allocatedKwh)} zugeordnet
                </span>
                <span
                  aria-hidden
                  className="mt-2.5 block h-1.5 w-full overflow-hidden rounded-full bg-border/60"
                >
                  <span
                    className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${(totals.allocatedKwh / maxAllocated) * 100}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-sm leading-7 text-muted-foreground">{KEY_DESCRIPTION_DE[selected]}</p>

        <AllocationDayChart run={run} />

        {/* Per-participant outcome */}
        <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Deckungsgrad je Teilnehmer
            </p>
            <p className="text-xs text-muted-foreground">
              Autarkie gesamt {pct(run.totals.autarkyRate)}
            </p>
          </div>
          <ul className="mt-4 space-y-2">
            {run.participants.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{p.label}</span>
                <span
                  aria-hidden
                  className="h-2 flex-1 overflow-hidden rounded-full bg-border/60"
                >
                  <span
                    className="block h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.min(100, (p.coverageRate ?? 0) * 100)}%` }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-foreground">
                  {p.coverageRate === null ? "—" : pct(p.coverageRate)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {run.warnings.length > 0 ? (
          <ul className="space-y-2">
            {run.warnings.map((w) => (
              <li
                key={w.code}
                className="flex items-start gap-2.5 rounded-2xl border border-border/60 bg-background/70 px-4 py-3"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm leading-6 text-foreground/90">{w.message}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-[0.72rem] leading-6 text-muted-foreground">
          {ILLUSTRATIVE_PROFILE_DISCLAIMER_DE} {run.disclaimer}
        </p>
      </div>
    </div>
  );
}

export default AllocationPanel;
