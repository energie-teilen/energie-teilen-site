import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Network } from "lucide-react";
import { buildMscons, MSCONS_PROFILE, type MsconsResult } from "../../../shared/mscons";
import { verifyInterchange } from "../../../shared/edifact";
import { dayGrid, intervalLabel } from "../../../shared/market-time";
import {
  deriveEan13CheckDigit,
  deriveMaloCheckDigit,
} from "../../../shared/market-ids";
import {
  allocate,
  illustrativeDayProfile,
  illustrativeShares,
} from "../../../shared/allocation";
import type { MieterstromInputs } from "../../../shared/schema";

/**
 * MarktkommunikationPanel
 *
 * The message a Lieferant actually has to send.
 *
 * Everything above this point is a calculation. This is the boundary where a
 * project stops being a spreadsheet: quarter-hour values have to leave the
 * building as MSCONS, addressed with valid market identifiers, on the real
 * local grid — and that grid is not 96 intervals long twice a year.
 *
 * The panel lets that day be selected, because the two clock-change days are
 * exactly where an implementation is worth judging. The message is generated
 * from the visitor's own constellation, its syntax is verified by reading the
 * produced message back, and the result says plainly which parts are proven
 * and which are not.
 */

const DAY_OPTIONS: { date: string; label: string; note: string }[] = [
  { date: "2026-06-15", label: "Normaler Tag", note: "96 Viertelstunden" },
  { date: "2026-03-29", label: "Zeitumstellung März", note: "92 Viertelstunden" },
  { date: "2026-10-25", label: "Zeitumstellung Oktober", note: "100 Viertelstunden" },
];

/** Placeholder market participants, formed so their check digits are consistent. */
const DEMO_SENDER = "999999999999" + deriveEan13CheckDigit("999999999999");
const DEMO_RECEIVER = "888888888888" + deriveEan13CheckDigit("888888888888");
const DEMO_MALO = "5012345678" + deriveMaloCheckDigit("5012345678");
const DEMO_MELO = "DE" + "0".repeat(25) + "12345A";

const KIND_NOTE: Record<string, string> = {
  normal: "Ein gewöhnlicher Tag.",
  dst_short:
    "An diesem Tag wird die Uhr vorgestellt: die Stunde von 02:00 bis 03:00 gibt es nicht, der Tag hat 92 Viertelstunden.",
  dst_long:
    "An diesem Tag wird die Uhr zurückgestellt: die Stunde von 02:00 bis 03:00 kommt zweimal vor, der Tag hat 100 Viertelstunden.",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
      <p className="text-[0.66rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-lg font-semibold tabular-nums ${
          tone === "warn" ? "text-amber-700" : tone === "good" ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function MarktkommunikationPanel({ inputs }: { inputs: MieterstromInputs }) {
  const [date, setDate] = useState(DAY_OPTIONS[2].date);

  const built = useMemo((): { result: MsconsResult; error: null } | { result: null; error: string } => {
    try {
      const grid = dayGrid(date);
      const participants = Math.max(2, Math.min(12, Math.round(inputs.anzahlWohneinheiten)));

      // The values on the wire are the ones the allocation engine produced,
      // on this day's real grid. Nothing is reshaped in between.
      const profile = illustrativeDayProfile({
        kwp: inputs.kwp,
        dailyConsumptionKwh: 8,
        participants,
        intervals: grid.intervals,
      });
      const shares = illustrativeShares(participants);
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

      return {
        result: buildMscons({
          period: { date },
          sender: { code: DEMO_SENDER },
          receiver: { code: DEMO_RECEIVER },
          locations: [
            {
              melo: DEMO_MELO,
              malo: DEMO_MALO,
              direction: "consumption",
              valuesKwh: allocation.participants[0].series ?? [],
            },
          ],
          preparedAtMs: Date.parse("2026-09-07T10:00:00Z"),
        }),
        error: null,
      };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : "Unbekannter Fehler." };
    }
  }, [date, inputs.kwp, inputs.anzahlWohneinheiten]);

  const grid = useMemo(() => dayGrid(date), [date]);
  const syntax = useMemo(
    () => (built.result ? verifyInterchange(built.result.message) : null),
    [built.result],
  );

  // The stretch of labels around the clock change is the part worth showing.
  const labelWindow = useMemo(() => {
    const start = grid.kind === "normal" ? 0 : 4;
    return Array.from({ length: 12 }, (_, i) => intervalLabel(grid, start + i));
  }, [grid]);

  const excerpt = built.result
    ? built.result.message.split("'").slice(0, 14).join("'") + "'"
    : "";

  return (
    <div className="rounded-[28px] border border-border/70 bg-card p-6 sm:p-8">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <Network className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-primary">
              Marktkommunikation
            </p>
            <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
              Die Nachricht, die tatsächlich das Haus verlässt
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">
              Viertelstundenwerte müssen als MSCONS an Netzbetreiber, Messstellenbetreiber
              und Bilanzkreisverantwortlichen gehen — mit gültigen Marktidentifikatoren und
              auf dem echten lokalen Zeitraster. Zweimal im Jahr hat ein Tag nicht 96
              Viertelstunden. Genau dort entscheidet sich, ob eine Umsetzung trägt.
            </p>
          </div>
        </div>

        {/* Day selection: the clock-change days are the interesting ones. */}
        <div className="grid gap-2.5 sm:grid-cols-3">
          {DAY_OPTIONS.map((o) => {
            const active = date === o.date;
            return (
              <button
                key={o.date}
                type="button"
                onClick={() => setDate(o.date)}
                aria-pressed={active}
                className={`rounded-2xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 bg-background/60 hover:border-border"
                }`}
              >
                <span className="block text-sm font-medium text-foreground">{o.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.date}</span>
                <span className="mt-2 block font-display text-base font-semibold text-foreground">
                  {o.note}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-sm leading-7 text-foreground/90">{KIND_NOTE[grid.kind]}</p>

        {/* The wall-clock labels around the transition. */}
        <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Viertelstunden um die Umstellung
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {labelWindow.map((l, i) => (
              <span
                key={`${l}-${i}`}
                className={`rounded-lg border px-2 py-1 font-mono text-xs tabular-nums ${
                  l.endsWith("A") || l.endsWith("B")
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-800"
                    : "border-border/60 bg-card text-foreground/80"
                }`}
              >
                {l}
              </span>
            ))}
          </div>
          {grid.kind === "dst_long" ? (
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              A und B unterscheiden den ersten vom zweiten Durchlauf derselben Stunde. Auf der
              Leitung trennt sie der UTC-Versatz: +02 und +01 zur selben Ortszeit.
            </p>
          ) : null}
          {grid.kind === "dst_short" ? (
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              Nach 01:45 folgt 03:00. Vier Viertelstunden entfallen — eine Reihe mit 96 Werten
              wäre an diesem Tag falsch.
            </p>
          ) : null}
        </div>

        {built.result && syntax ? (
          <>
            <div className="grid gap-2.5 sm:grid-cols-4">
              <Stat label="Viertelstunden" value={String(built.result.grid.intervals)} />
              <Stat label="Mengen im Segment QTY" value={String(built.result.totals[0].values)} />
              <Stat label="Nachrichtengröße" value={`${(built.result.bytes / 1024).toFixed(1)} kB`} />
              <Stat
                label="Syntaxprüfung"
                value={syntax.ok ? "bestanden" : `${syntax.findings.length} Befunde`}
                tone={syntax.ok ? "good" : "warn"}
              />
            </div>

            <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  MSCONS · {MSCONS_PROFILE.directory.version} {MSCONS_PROFILE.directory.release}{" "}
                  {MSCONS_PROFILE.directory.agency} · {MSCONS_PROFILE.associationCode}
                </p>
                <p className="text-xs text-muted-foreground">Auszug — Kopf und erste Messwerte</p>
              </div>
              {/* Scrollable regions need to be focusable, or a keyboard user
                  cannot reach the content below the fold. */}
              <pre
                tabIndex={0}
                role="region"
                aria-label="Auszug der erzeugten MSCONS-Nachricht"
                className="mt-3 max-h-64 overflow-auto rounded-xl border border-border/50 bg-card p-4 font-mono text-[0.7rem] leading-6 text-foreground/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {excerpt.replace(/'/g, "'\n")}
              </pre>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                Der OBIS-Code enthält den Komponententrenner und erscheint deshalb als{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">1-1?:1.29.0</code> — mit
                Freigabezeichen. Ohne diese Maskierung zerfällt das Element, und die Nachricht
                meldet eine andere Messgröße als gemeint.
              </p>
            </div>

            {/* What is proven, and what is not. Kept apart on purpose. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Geprüft: Syntax
                </p>
                <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                  Freigabezeichen, Segmentzählung in UNT und Kontrollreferenz in UNZ werden aus
                  dem Inhalt berechnet und anschließend aus der erzeugten Nachricht heraus
                  nachgeprüft — nicht aus dem Code angenommen.
                </p>
              </div>
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/6 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Offen: Profilfassung
                </p>
                <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                  {MSCONS_PROFILE.openQuestion}
                </p>
              </div>
            </div>

            {built.result.warnings
              .filter((w) => w.code !== "profile_unverified")
              .map((w) => (
                <p key={w.code} className="text-xs leading-6 text-muted-foreground">
                  {w.message}
                </p>
              ))}
          </>
        ) : (
          <p className="rounded-2xl border border-destructive/25 bg-destructive/6 p-4 text-sm leading-6 text-foreground/90">
            {built.error}
          </p>
        )}
      </div>
    </div>
  );
}

export default MarktkommunikationPanel;
