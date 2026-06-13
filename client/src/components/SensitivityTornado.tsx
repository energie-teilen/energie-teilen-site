import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import type { MieterstromInputs } from "../../../shared/schema";
import { sensitivity, type Kpi } from "@/lib/sensitivity";

export function SensitivityTornado({ inputs, kpi = "irrPct" }: { inputs: MieterstromInputs; kpi?: Kpi }) {
  const rows = useMemo(() => sensitivity(inputs, kpi, 0.2), [inputs, kpi]);
  const unit = kpi === "irrPct" ? "%" : "€";
  const data = rows.map((r) => ({ label: r.label, lowDelta: r.low - r.base, highDelta: r.high - r.base, low: r.low, high: r.high }));
  return (
    <div className="space-y-2">
      <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">Sensitivität ({kpi === "irrPct" ? "IRR" : "NPV"})</p>
      <p className="text-sm text-muted-foreground">Welche Annahme bewegt das Ergebnis am stärksten? (±20 %)</p>
      <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 34)}>
        <BarChart layout="vertical" data={data} margin={{ left: 8, right: 16 }} stackOffset="sign">
          <XAxis type="number" tickFormatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}${unit}`} fontSize={11} />
          <YAxis type="category" dataKey="label" width={130} fontSize={11} />
          <ReferenceLine x={0} stroke="#1d493a" />
          <Tooltip formatter={(v: number, n) => [`${(v as number) > 0 ? "+" : ""}${(v as number).toFixed(1)}${unit}`, n === "lowDelta" ? "−20 %" : "+20 %"]} />
          <Bar dataKey="lowDelta" stackId="s">{data.map((_, i) => <Cell key={i} fill="#94735b" />)}</Bar>
          <Bar dataKey="highDelta" stackId="s">{data.map((_, i) => <Cell key={i} fill="#c79236" />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export default SensitivityTornado;
