import { useMemo, useState } from "react";
import {
  INTERVALS_PER_HOUR,
  type AllocationResult,
} from "../../../shared/allocation";

/**
 * AllocationDayChart
 *
 * One day of fifteen-minute intervals: how much of the generation went to
 * participants, and how much was fed in.
 *
 * Drawn from the same result the panel reports in figures, so the picture and
 * the numbers cannot disagree. Hovering reads out a single interval — the
 * resolution the market actually settles at.
 */

const W = 900;
const H = 300;
const PAD = { top: 18, right: 18, bottom: 34, left: 52 };

function hourLabel(interval: number): string {
  const h = Math.floor(interval / INTERVALS_PER_HOUR);
  const m = (interval % INTERVALS_PER_HOUR) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function AllocationDayChart({ run }: { run: AllocationResult }) {
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => {
    const generation = run.generationSeries ?? [];
    const n = generation.length;
    const allocated = new Array<number>(n).fill(0);
    for (const p of run.participants) {
      if (!p.series) continue;
      for (let t = 0; t < n; t++) allocated[t] += p.series[t];
    }
    const peak = Math.max(...generation, 0.0001);
    return { generation, allocated, n, peak };
  }, [run]);

  if (data.n === 0) return null;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / (data.n - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / data.peak) * plotH;

  const areaPath = (series: number[]) => {
    const top = series.map((v, t) => `${t === 0 ? "M" : "L"} ${x(t).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
    return `${top} L ${x(data.n - 1).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z`;
  };

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => ({ f, v: data.peak * f }));

  return (
    <figure className="overflow-hidden rounded-[20px] border border-border/60 bg-background/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
        <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Beispieltag · {data.n} Viertelstunden
        </p>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-primary/70" />
            An Teilnehmer zugeordnet
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-primary/18" />
            Eingespeist
          </span>
        </div>
      </div>

      {/* Focusable: at narrow widths this scrolls, and a region a keyboard
          user cannot scroll hides its content from them entirely. */}
      <div
        className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        tabIndex={0}
        role="region"
        aria-label="Tagesverlauf der Zuordnung, horizontal scrollbar"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Zuordnung über einen Tag, ${run.keyLabel}`}
          className="h-auto w-full min-w-[34rem]"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const t = Math.round(((px - PAD.left) / plotW) * (data.n - 1));
            setHover(t >= 0 && t < data.n ? t : null);
          }}
        >
          {gridLines.map(({ f, v }) => (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="color-mix(in oklab, var(--foreground) 10%, transparent)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(v) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {v.toLocaleString("de-DE", { maximumFractionDigits: 1 })}
              </text>
            </g>
          ))}
          <text
            x={PAD.left - 8}
            y={y(0) + 4}
            textAnchor="end"
            fontSize={11}
            fill="var(--muted-foreground)"
          >
            0
          </text>

          {/* Generation envelope — everything under it was produced. */}
          <path
            d={areaPath(data.generation)}
            fill="color-mix(in oklab, var(--primary) 14%, transparent)"
          />
          {/* Allocated share — what stayed with the participants. */}
          <path
            d={areaPath(data.allocated)}
            fill="color-mix(in oklab, var(--primary) 55%, transparent)"
          />
          <path
            d={data.generation
              .map((v, t) => `${t === 0 ? "M" : "L"} ${x(t).toFixed(2)} ${y(v).toFixed(2)}`)
              .join(" ")}
            fill="none"
            stroke="color-mix(in oklab, var(--primary) 70%, transparent)"
            strokeWidth={1.75}
          />

          {/* Hour ticks every three hours */}
          {Array.from({ length: 9 }, (_, i) => i * 3 * INTERVALS_PER_HOUR)
            .filter((t) => t < data.n)
            .map((t) => (
              <text
                key={t}
                x={x(t)}
                y={H - 12}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {hourLabel(t)}
              </text>
            ))}

          {hover !== null ? (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="color-mix(in oklab, var(--foreground) 32%, transparent)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <circle cx={x(hover)} cy={y(data.generation[hover])} r={3.5} fill="var(--primary)" />
              <circle cx={x(hover)} cy={y(data.allocated[hover])} r={3.5} fill="var(--primary)" />
            </g>
          ) : null}
        </svg>
      </div>

      <figcaption className="border-t border-border/50 px-5 py-3 text-xs leading-6 text-muted-foreground">
        {hover === null ? (
          <>
            {run.keyLabel} · {run.totals.allocatedKwh.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kWh
            zugeordnet, {run.totals.feedInKwh.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kWh
            eingespeist. Zeigen Sie auf den Verlauf für eine einzelne Viertelstunde.
          </>
        ) : (
          <>
            {hourLabel(hover)} · Erzeugung{" "}
            {data.generation[hover].toLocaleString("de-DE", { maximumFractionDigits: 2 })} kWh ·
            zugeordnet {data.allocated[hover].toLocaleString("de-DE", { maximumFractionDigits: 2 })} kWh
            · eingespeist{" "}
            {(data.generation[hover] - data.allocated[hover]).toLocaleString("de-DE", {
              maximumFractionDigits: 2,
            })}{" "}
            kWh
          </>
        )}
      </figcaption>
    </figure>
  );
}

export default AllocationDayChart;
