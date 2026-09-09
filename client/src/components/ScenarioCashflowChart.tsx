import { memo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * The cumulative-cashflow chart shown on each scenario card.
 *
 * It lives in its own module so the chart library can be code-split. Imported
 * from the page directly, recharts was pulled into the first paint — the
 * largest single chunk in the build, loaded by every visitor whether or not
 * they ever reached the calculator.
 */

const eurFmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(n));

export const ScenarioCashflowChart = memo(function ScenarioCashflowChart({
  data,
  accent,
}: {
  data: Array<{ jahr: number; kumuliert: number }>;
  accent: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`grad-${accent}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.28} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.08)" />
        <XAxis
          dataKey="jahr"
          stroke="rgba(0,0,0,0.4)"
          fontSize={11}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          stroke="rgba(0,0,0,0.4)"
          fontSize={11}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(v: number) => [`${eurFmt(v)} €`, "Kumuliert"]}
          labelFormatter={(l) => `Jahr ${l}`}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.08)",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="kumuliert"
          stroke={accent}
          strokeWidth={2}
          fill={`url(#grad-${accent})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export default ScenarioCashflowChart;
