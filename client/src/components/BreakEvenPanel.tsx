import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { MieterstromInputs } from "../../../shared/schema";
import { solveForTarget } from "@/lib/sensitivity";

type Lever = {
  key: keyof MieterstromInputs;
  label: string;
  toDisplay: (v: number) => string;
  hint: string;
};

const LEVERS: Lever[] = [
  { key: "eigenverbrauchsquote", label: "Eigenverbrauchsquote", toDisplay: (v) => `${Math.round(v * 100)} %`, hint: "Anteil des vor Ort genutzten Stroms" },
  { key: "strompreisMieterCtPerKwh", label: "Strompreis Mieter", toDisplay: (v) => `${v.toFixed(1)} ct/kWh`, hint: "Arbeitspreis für die Mietparteien" },
  { key: "investitionEurPerKwp", label: "Investition", toDisplay: (v) => `${Math.round(v)} €/kWp`, hint: "Spezifische Anlagenkosten" },
];

export function BreakEvenPanel({ inputs }: { inputs: MieterstromInputs }) {
  const [targetIrr, setTargetIrr] = useState(10);
  const [leverIdx, setLeverIdx] = useState(0);
  const lever = LEVERS[leverIdx];

  const solution = useMemo(() => {
    const r = solveForTarget(inputs, lever.key, targetIrr, "irrPct");
    return r.ok ? { ok: true as const, display: lever.toDisplay(r.value) } : { ok: false as const };
  }, [inputs, lever, targetIrr]);

  return (
    <Card className="ledger-panel h-fit border-border/70 bg-card">
      <CardContent className="space-y-5 p-6 lg:p-7">
        <div className="space-y-2">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
            Break-Even-Analyse
          </p>
          <h3 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
            Welcher Wert erreicht Ihr Renditeziel?
          </h3>
          <p className="text-sm leading-7 text-muted-foreground">
            Geben Sie ein IRR-Ziel vor und wählen Sie den Hebel. Die Berechnung
            löst rückwärts über dieselbe Engine — exakt, nachvollziehbar.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">Ziel-IRR</label>
            <span className="font-display text-base font-semibold text-foreground">{targetIrr} %</span>
          </div>
          <input
            type="range" min={2} max={25} step={0.5} value={targetIrr}
            onChange={(e) => setTargetIrr(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Hebel</label>
          <div className="grid grid-cols-3 gap-2">
            {LEVERS.map((l, i) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLeverIdx(i)}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-medium transition " +
                  (i === leverIdx
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/70 text-muted-foreground hover:bg-muted")
                }
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-primary/15 bg-primary/6 p-5">
          {solution.ok ? (
            <>
              <p className="text-sm text-muted-foreground">
                Für <span className="font-medium text-foreground">{targetIrr} % IRR</span> benötigen Sie
              </p>
              <p className="mt-1 font-display text-2xl font-semibold text-foreground">
                {lever.label}: {solution.display}
              </p>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{lever.hint}. Alle übrigen Annahmen unverändert.</p>
            </>
          ) : (
            <p className="text-sm leading-7 text-muted-foreground">
              Dieses Ziel ist über <span className="font-medium text-foreground">{lever.label}</span> allein
              im realistischen Bereich nicht erreichbar. Wählen Sie einen anderen Hebel oder ein niedrigeres Ziel.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default BreakEvenPanel;
