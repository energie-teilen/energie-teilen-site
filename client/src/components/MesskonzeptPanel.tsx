import { useEffect, useMemo } from "react";
import { AlertTriangle, CircleHelp, Gauge, Users, Workflow } from "lucide-react";
import { track } from "@/lib/analytics";
import { MesskonzeptTopology } from "@/components/MesskonzeptTopology";
import {
  criticalPath,
  deriveMesskonzept,
  type GridConnection,
  type MesskonzeptInput,
  type MesskonzeptVariant,
  type Storage,
} from "../../../shared/messkonzept";
import type { QualificationFacts } from "../../../shared/eligibility";
import type { MieterstromInputs } from "../../../shared/schema";

/**
 * MesskonzeptPanel
 *
 * The step after the economics: how the constellation is actually metered.
 *
 * It reads the qualification answers already given above and asks only for what
 * it additionally needs — the grid-connection situation, storage and commercial
 * units. From those it derives the metering variant, the meter inventory, the
 * market roles and the ordered critical path, and draws the topology.
 *
 * The engine refuses to guess: without the connection situation the variant is
 * "not determinable" and the panel says so instead of showing a plausible
 * diagram that might be the wrong one.
 */

export type MesskonzeptAnswers = {
  gridConnection?: GridConnection;
  storage?: Storage;
  commercialUnits?: number;
};

const GRID_OPTIONS: { value: GridConnection; label: string; hint: string }[] = [
  {
    value: "single_connection",
    label: "Ein gemeinsamer Hausanschluss",
    hint: "Alle Einheiten liegen hinter einem Netzanschlusspunkt.",
  },
  {
    value: "per_unit_connection",
    label: "Ein Anschluss je Einheit",
    hint: "Jede Einheit ist einzeln ans Netz angeschlossen.",
  },
  {
    value: "public_grid",
    label: "Beteiligte im öffentlichen Netz",
    hint: "Die Teilnehmer liegen an unterschiedlichen Netzanschlusspunkten.",
  },
];

const STORAGE_OPTIONS: { value: Storage; label: string }[] = [
  { value: "none", label: "Kein Speicher" },
  { value: "planned", label: "Speicher geplant" },
  { value: "existing", label: "Speicher vorhanden" },
];

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Belastbar auf Basis der Angaben",
  medium: "Vorläufig — mehrere Angaben offen",
  insufficient_data: "Nicht bestimmbar",
};

const VARIANT_TONE: Record<MesskonzeptVariant, string> = {
  summenzaehler: "border-primary/25 bg-primary/5",
  einzelzaehler: "border-primary/25 bg-primary/5",
  viertelstunden_bilanzierung: "border-amber-500/30 bg-amber-500/6",
  not_determinable: "border-border/70 bg-card",
};

function Chip({
  active,
  onClick,
  children,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-2xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        active
          ? "border-primary/50 bg-primary/8 text-foreground"
          : "border-border/70 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      <span className="block text-sm font-medium leading-6">{children}</span>
      {hint ? (
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{hint}</span>
      ) : null}
    </button>
  );
}

export function MesskonzeptPanel({
  inputs,
  facts,
  answers,
  onAnswersChange,
}: {
  inputs: MieterstromInputs;
  facts: QualificationFacts;
  answers: MesskonzeptAnswers;
  onAnswersChange: (next: MesskonzeptAnswers) => void;
}) {
  const constellation: MesskonzeptInput = useMemo(
    () => ({
      units: Math.max(1, Math.round(inputs.anzahlWohneinheiten)),
      kwp: inputs.kwp,
      gridConnection: answers.gridConnection,
      buildingScope: facts.buildingScope,
      ownerConstellation: facts.ownerConstellation,
      generationStatus: facts.generationStatus,
      metering: facts.metering,
      storage: answers.storage,
      commercialUnits: answers.commercialUnits,
    }),
    [inputs.anzahlWohneinheiten, inputs.kwp, answers, facts],
  );

  const result = useMemo(() => deriveMesskonzept(constellation), [constellation]);
  const path = useMemo(() => criticalPath(result), [result]);

  const determinable = result.variant !== "not_determinable";

  // Which metering variant visitors land on is the signal that says which
  // constellation the market actually brings, and where the concept stalls.
  useEffect(() => {
    track("messkonzept_derived", {
      variant: result.variant,
      confidence: result.confidence,
      meters: result.meterCount,
      blocking: path.length,
    });
  }, [result.variant, result.confidence, result.meterCount, path.length]);

  return (
    <div className="space-y-5">
      {/* ── The one question the variant actually turns on ── */}
      <div className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6">
        <div className="space-y-1">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-primary">
            Messkonzept
          </p>
          <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
            Wie wird gemessen — und wie viele Zähler braucht es?
          </h3>
          <p className="text-sm leading-7 text-muted-foreground">
            Die Wirtschaftlichkeit entscheidet, ob sich ein Projekt lohnt. Das
            Messkonzept entscheidet, ob es gebaut werden kann. Ausschlaggebend ist
            die Netzanschlusssituation.
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Netzanschlusssituation
            </p>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {GRID_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  active={answers.gridConnection === o.value}
                  hint={o.hint}
                  onClick={() =>
                    onAnswersChange({
                      ...answers,
                      gridConnection: answers.gridConnection === o.value ? undefined : o.value,
                    })
                  }
                >
                  {o.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Speicher
              </span>
              <select
                value={answers.storage ?? ""}
                onChange={(e) =>
                  onAnswersChange({
                    ...answers,
                    storage: (e.target.value || undefined) as Storage | undefined,
                  })
                }
                className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <option value="">Keine Angabe</option>
                {STORAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Davon gewerbliche Einheiten
              </span>
              <input
                type="number"
                min={0}
                max={Math.round(inputs.anzahlWohneinheiten)}
                value={answers.commercialUnits ?? ""}
                placeholder="Keine Angabe"
                onChange={(e) => {
                  const raw = e.target.value;
                  onAnswersChange({
                    ...answers,
                    commercialUnits: raw === "" ? undefined : Math.max(0, Number(raw)),
                  });
                }}
                className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </label>
          </div>
        </div>
      </div>

      {/* ── Variant, topology and inventory ── */}
      <div className={`rounded-[28px] border p-6 sm:p-8 ${VARIANT_TONE[result.variant]}`}>
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            {determinable ? (
              <Gauge className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
            ) : (
              <CircleHelp className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Abgeleitetes Messkonzept · {CONFIDENCE_LABEL[result.confidence]}
              </p>
              <h4 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
                {result.variantLabel}
              </h4>
              <p className="text-sm leading-7 text-foreground/90">{result.rationale}</p>
            </div>
          </div>

          {determinable ? (
            <>
              <MesskonzeptTopology result={result} units={constellation.units} />

              {/* Meter inventory */}
              <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Zählerinventar
                  </p>
                  <p className="font-display text-lg font-semibold text-foreground">
                    {result.meterCount} Messeinrichtungen
                  </p>
                </div>
                <div
                  className="mt-4 overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  tabIndex={0}
                  role="region"
                  aria-label="Zählerinventar, horizontal scrollbar"
                >
                  <table className="w-full min-w-[34rem] text-left text-sm">
                    <thead>
                      <tr className="text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Zähler</th>
                        <th className="pb-2 pr-4 font-medium">Anzahl</th>
                        <th className="pb-2 pr-4 font-medium">Eigenschaft</th>
                        <th className="pb-2 font-medium">Zweck</th>
                      </tr>
                    </thead>
                    <tbody className="align-top">
                      {result.meters.map((m) => (
                        <tr key={m.code} className="border-t border-border/50">
                          <td className="py-3 pr-4 font-medium text-foreground">{m.label}</td>
                          <td className="py-3 pr-4 tabular-nums text-foreground">{m.count}</td>
                          <td className="py-3 pr-4 text-muted-foreground">
                            <span className="flex flex-wrap gap-1.5">
                              {m.bidirectional ? (
                                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[0.68rem]">
                                  Zweirichtung
                                </span>
                              ) : null}
                              {m.intervalMetering ? (
                                <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[0.68rem] text-amber-800">
                                  15-Minuten-Werte
                                </span>
                              ) : null}
                              {!m.bidirectional && !m.intervalMetering ? (
                                <span className="text-[0.68rem]">Standard</span>
                              ) : null}
                            </span>
                          </td>
                          <td className="py-3 leading-6 text-muted-foreground">{m.purpose}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Market roles */}
              <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
                <p className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Marktrollen
                </p>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {result.roles.map((r) => (
                    <li key={r.code} className="rounded-2xl border border-border/50 bg-card/60 p-4">
                      <p className="font-display text-sm font-semibold text-foreground">{r.label}</p>
                      <p className="mt-1 text-xs leading-6 text-primary/90">{r.filledBy}</p>
                      <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                        {r.responsibility}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          {/* Critical path — blocking first, then the rest */}
          <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
            <p className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" />
              {determinable ? `Kritischer Pfad · ${path.length} blockierende Schritte` : "Nächster Schritt"}
            </p>
            <ol className="mt-4 space-y-3">
              {result.tasks.map((t, i) => (
                <li key={t.code} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold tabular-nums ${
                      t.blocking
                        ? "bg-primary/12 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-6 text-foreground/90">{t.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t.owner}
                      {t.blocking ? " · blockierend" : " · parallel möglich"}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {result.warnings.length > 0 ? (
            <ul className="space-y-2.5">
              {result.warnings.map((w) => (
                <li
                  key={w.code}
                  className="flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/6 px-4 py-3"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span className="text-sm leading-6 text-foreground/90">{w.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {result.missingInputs.length > 0 ? (
            <p className="text-xs leading-6 text-muted-foreground">
              Noch offen: {result.missingInputs.join(" · ")}
            </p>
          ) : null}

          <p className="text-[0.72rem] leading-6 text-muted-foreground">{result.disclaimer}</p>
        </div>
      </div>
    </div>
  );
}

export default MesskonzeptPanel;
