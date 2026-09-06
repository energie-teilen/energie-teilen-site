import { useEffect, useMemo } from "react";
import { AlertTriangle, ArrowRight, CircleHelp, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import {
  FACT_LABEL_DE,
  evaluateEligibility,
  intakeChecklistFor,
  type EligibilityVerdict,
  type QualificationFacts,
} from "../../../shared/eligibility";
import type { MieterstromInputs } from "../../../shared/schema";
import type { MieterstromResult } from "@/lib/mieterstrom";

/**
 * EligibilityPanel
 *
 * The calculator used to compute NPV for anything you typed and stop there —
 * it qualified nobody. This turns the result into a decision: whether the
 * constellation clears the economic and structural bar, which fact is missing,
 * and which paid step is actually next.
 *
 * Four optional questions. Nothing is required, and nothing is assumed: an
 * unanswered question reports as a named gap rather than silently defaulting
 * to the answer that flatters the project. That named gap is the honest reason
 * to buy the Eligibility Check.
 *
 * The verdict never claims legal compliance — the engine enforces that and
 * eligibility.test.ts pins it.
 */

type SelectOption<T extends string> = { value: T; label: string };

const OWNER_OPTIONS: SelectOption<NonNullable<QualificationFacts["ownerConstellation"]>>[] = [
  { value: "single_owner", label: "Ein Eigentümer" },
  { value: "weg", label: "Eigentümergemeinschaft (WEG)" },
  { value: "multiple_owners", label: "Mehrere Eigentümer" },
];

const SCOPE_OPTIONS: SelectOption<NonNullable<QualificationFacts["buildingScope"]>>[] = [
  { value: "single_building", label: "Ein Gebäude" },
  { value: "multiple_buildings_same_site", label: "Mehrere Gebäude, ein Grundstück" },
  { value: "across_grid", label: "Über mehrere Standorte" },
];

const GENERATION_OPTIONS: SelectOption<NonNullable<QualificationFacts["generationStatus"]>>[] = [
  { value: "existing", label: "Anlage vorhanden" },
  { value: "planned", label: "Anlage geplant" },
  { value: "none", label: "Weder vorhanden noch geplant" },
];

const METERING_OPTIONS: SelectOption<NonNullable<QualificationFacts["metering"]>>[] = [
  { value: "ready", label: "Messkonzept steht" },
  { value: "planned", label: "Messkonzept in Arbeit" },
  { value: "unclear", label: "Ungeklärt" },
];

const VERDICT_STYLE: Record<
  EligibilityVerdict,
  { tone: string; icon: typeof ShieldCheck; iconClass: string }
> = {
  ELIGIBLE: { tone: "border-primary/30 bg-primary/6", icon: ShieldCheck, iconClass: "text-primary" },
  LIKELY_ELIGIBLE: { tone: "border-primary/20 bg-primary/4", icon: ShieldCheck, iconClass: "text-primary/80" },
  REQUIRES_REVIEW: { tone: "border-amber-500/30 bg-amber-500/8", icon: AlertTriangle, iconClass: "text-amber-600" },
  INSUFFICIENT_DATA: { tone: "border-border/70 bg-card", icon: CircleHelp, iconClass: "text-muted-foreground" },
  NOT_ELIGIBLE: { tone: "border-destructive/25 bg-destructive/6", icon: XCircle, iconClass: "text-destructive" },
};

function FactSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: SelectOption<T>[];
  onChange: (v: T | undefined) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
        className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <option value="">Keine Angabe</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-[0.72rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm leading-7 text-foreground/90">{children}</dd>
    </div>
  );
}

export function EligibilityPanel({
  inputs,
  result,
  facts,
  onFactsChange,
  onProceedToPilot,
}: {
  inputs: MieterstromInputs;
  result: MieterstromResult;
  /** Owned by the calculator so the PDF sees the same answers. */
  facts: QualificationFacts;
  onFactsChange: (next: QualificationFacts) => void;
  onProceedToPilot: () => void;
}) {
  const evaluation = useMemo(
    () => evaluateEligibility({ economics: inputs, kpis: result.kpis, facts }),
    [inputs, result.kpis, facts],
  );

  // Which verdict a visitor reaches, and which tier it recommends, is the one
  // number that tells you whether the qualification gate is working.
  useEffect(() => {
    track("eligibility_verdict", {
      verdict: evaluation.verdict,
      effort: evaluation.estimatedEffort,
      missing: evaluation.missingData.length,
    });
    if (evaluation.nextPaidStep) {
      track("next_step_shown", {
        offer: evaluation.nextPaidStep.offerCode,
        verdict: evaluation.verdict,
      });
    }
  }, [evaluation.verdict, evaluation.estimatedEffort, evaluation.missingData.length, evaluation.nextPaidStep?.offerCode]);

  const style = VERDICT_STYLE[evaluation.verdict];
  const Icon = style.icon;
  const set = <K extends keyof QualificationFacts>(key: K) =>
    (v: QualificationFacts[K]) => onFactsChange({ ...facts, [key]: v });

  return (
    <div className="space-y-5">
      {/* ── Four optional questions. Unanswered = named gap, never assumed. ── */}
      <div className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6">
        <div className="space-y-1">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-primary">
            Qualifizierung
          </p>
          <p className="text-sm leading-7 text-muted-foreground">
            Vier optionale Angaben. Was Sie offen lassen, wird unten ausdrücklich als
            fehlend ausgewiesen — es wird nichts angenommen.
          </p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FactSelect
            label={FACT_LABEL_DE.ownerConstellation}
            value={facts.ownerConstellation}
            options={OWNER_OPTIONS}
            onChange={set("ownerConstellation")}
          />
          <FactSelect
            label={FACT_LABEL_DE.buildingScope}
            value={facts.buildingScope}
            options={SCOPE_OPTIONS}
            onChange={set("buildingScope")}
          />
          <FactSelect
            label={FACT_LABEL_DE.generationStatus}
            value={facts.generationStatus}
            options={GENERATION_OPTIONS}
            onChange={set("generationStatus")}
          />
          <FactSelect
            label={FACT_LABEL_DE.metering}
            value={facts.metering}
            options={METERING_OPTIONS}
            onChange={set("metering")}
          />
        </div>
      </div>

      {/* ── The verdict and the six lines that must follow every result. ── */}
      <div className={`rounded-[28px] border p-6 sm:p-8 ${style.tone}`}>
        <div className="flex items-start gap-4">
          <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${style.iconClass}`} />
          <div className="min-w-0 flex-1 space-y-6">
            <div className="space-y-1">
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Einordnung der Konstellation
              </p>
              <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
                {evaluation.verdictLabel}
              </h3>
            </div>

            <dl className="space-y-4">
              <Line label="Machbarkeit">{evaluation.feasibility}</Line>
              <Line label="Werttreiber">{evaluation.valueDriver}</Line>
              <Line label="Hauptrisiko">{evaluation.mainRisk}</Line>
              <Line label="Fehlende Daten">
                {evaluation.missingData.length === 0 ? (
                  "Keine — alle abgefragten Angaben liegen vor."
                ) : (
                  <ul className="space-y-1.5">
                    {evaluation.missingData.map((m) => (
                      <li key={m} className="flex items-start gap-2.5">
                        <span
                          aria-hidden
                          className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70"
                        />
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Line>
              <Line label="Aufwand">
                {evaluation.estimatedEffort}
                <span className="text-muted-foreground">
                  {" "}
                  — Einordnung des Arbeitsumfangs, keine Terminzusage.
                </span>
              </Line>
            </dl>

            {/* ── Never "Contact us". A named step, or an honest stop. ── */}
            {evaluation.nextPaidStep ? (
              <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
                <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Nächster bezahlter Schritt
                </p>
                <p className="mt-2 font-display text-base font-semibold text-foreground">
                  {evaluation.nextPaidStep.label}
                </p>
                <p className="mt-2 text-sm leading-7 text-foreground/90">
                  {evaluation.nextPaidStep.rationale}
                </p>

                {intakeChecklistFor(evaluation.nextPaidStep).length > 0 ? (
                  <details className="mt-4 group">
                    <summary className="cursor-pointer text-sm text-primary underline-offset-4 hover:underline">
                      Was dafür benötigt wird
                    </summary>
                    <ul className="mt-3 space-y-1.5">
                      {intakeChecklistFor(evaluation.nextPaidStep).map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2.5 text-sm leading-7 text-muted-foreground"
                        >
                          <span
                            aria-hidden
                            className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50"
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <Button
                  onClick={() => {
                    track("next_step_clicked", {
                      offer: evaluation.nextPaidStep!.offerCode,
                      verdict: evaluation.verdict,
                    });
                    onProceedToPilot();
                  }}
                  size="lg"
                  className="mt-5 rounded-full"
                >
                  {evaluation.nextPaidStep.label} starten
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : (
              // Selling into a known blocker would be selling a failure.
              <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
                <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Nächster Schritt
                </p>
                <p className="mt-2 text-sm leading-7 text-foreground/90">
                  In dieser Form empfehlen wir keinen bezahlten Schritt. Ändern Sie die
                  Konstellation oben — etwa Anlagengröße, Anzahl der Einheiten oder den
                  Status der Erzeugungsanlage — und die Einordnung aktualisiert sich sofort.
                </p>
              </div>
            )}

            <p className="text-[0.72rem] leading-6 text-muted-foreground">
              Diese Einordnung betrifft ausschließlich wirtschaftliche und strukturelle
              Voraussetzungen. Sie trifft keine Aussage über die rechtliche Zulässigkeit
              und ersetzt keine fachliche Prüfung.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EligibilityPanel;
