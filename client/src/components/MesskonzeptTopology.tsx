import { useMemo } from "react";
import type { MesskonzeptResult } from "../../../shared/messkonzept";

/**
 * MesskonzeptTopology
 *
 * Draws the derived metering concept: where the plant sits, which meter stands
 * at which point, and how the units connect.
 *
 * Rendered from the same result object the panel shows in table form, so the
 * diagram can never disagree with the inventory beside it. Nothing here decides
 * anything — it only draws what the engine derived.
 */

const W = 900;
const H = 420;

/** Above this, units are drawn as a group with a count rather than one by one. */
const MAX_DRAWN_UNITS = 8;

type Tone = "grid" | "plant" | "meter" | "unit" | "storage";

const TONE_FILL: Record<Tone, string> = {
  grid: "var(--muted)",
  plant: "color-mix(in oklab, var(--primary) 12%, transparent)",
  meter: "var(--card)",
  unit: "var(--card)",
  storage: "color-mix(in oklab, var(--primary) 8%, transparent)",
};

const TONE_STROKE: Record<Tone, string> = {
  grid: "var(--border)",
  plant: "color-mix(in oklab, var(--primary) 45%, transparent)",
  meter: "color-mix(in oklab, var(--primary) 35%, transparent)",
  unit: "var(--border)",
  storage: "color-mix(in oklab, var(--primary) 35%, transparent)",
};

function Node({
  x,
  y,
  w,
  h,
  tone,
  title,
  subtitle,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: Tone;
  title: string;
  subtitle?: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={14}
        fill={TONE_FILL[tone]}
        stroke={TONE_STROKE[tone]}
        strokeWidth={1.5}
      />
      <text
        x={x + w / 2}
        y={subtitle ? y + h / 2 - 4 : y + h / 2 + 5}
        textAnchor="middle"
        fontSize={15}
        fontWeight={600}
        fill="var(--foreground)"
      >
        {title}
      </text>
      {subtitle ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 16}
          textAnchor="middle"
          fontSize={12}
          fill="var(--muted-foreground)"
        >
          {subtitle}
        </text>
      ) : null}
    </g>
  );
}

/** A meter symbol on a line: the circle every schematic uses. */
function Meter({
  x,
  y,
  label,
  interval,
  bidirectional,
}: {
  x: number;
  y: number;
  label: string;
  interval?: boolean;
  bidirectional?: boolean;
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={15}
        fill="var(--card)"
        stroke={interval ? "var(--chart-4, var(--primary))" : "color-mix(in oklab, var(--primary) 55%, transparent)"}
        strokeWidth={2}
      />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        fontSize={bidirectional ? 13 : 9}
        fontWeight={700}
        fill="var(--foreground)"
      >
        {bidirectional ? "⇅" : "kWh"}
      </text>
      <text x={x} y={y + 32} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
        {label}
      </text>
      {interval ? (
        <text x={x} y={y + 46} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
          15-Min
        </text>
      ) : null}
    </g>
  );
}

function Wire({
  d,
  dashed,
  label,
}: {
  d: string;
  dashed?: boolean;
  label?: { x: number; y: number; text: string };
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke="color-mix(in oklab, var(--foreground) 28%, transparent)"
        strokeWidth={1.75}
        strokeDasharray={dashed ? "6 5" : undefined}
        strokeLinecap="round"
      />
      {label ? (
        <text
          x={label.x}
          y={label.y}
          textAnchor="middle"
          fontSize={11}
          fill="var(--muted-foreground)"
        >
          {label.text}
        </text>
      ) : null}
    </g>
  );
}

function UnitRow({
  units,
  y,
  meterLabel,
  interval,
  connectTo,
}: {
  units: number;
  y: number;
  meterLabel: string;
  interval: boolean;
  /** y-coordinate of the bus or bar the units connect up to. */
  connectTo: number;
}) {
  const drawn = Math.min(units, MAX_DRAWN_UNITS);
  const boxW = 82;
  const gap = 14;
  const totalW = drawn * boxW + (drawn - 1) * gap;
  const startX = (W - totalW) / 2;

  return (
    <g>
      {Array.from({ length: drawn }, (_, i) => {
        const x = startX + i * (boxW + gap);
        const cx = x + boxW / 2;
        return (
          <g key={i}>
            <Wire d={`M ${cx} ${connectTo} L ${cx} ${y - 26}`} />
            <circle
              cx={cx}
              cy={y - 26}
              r={9}
              fill="var(--card)"
              stroke={
                interval
                  ? "var(--chart-4, var(--primary))"
                  : "color-mix(in oklab, var(--primary) 45%, transparent)"
              }
              strokeWidth={1.75}
            />
            <Node
              x={x}
              y={y}
              w={boxW}
              h={46}
              tone="unit"
              title={`WE ${i + 1}`}
            />
          </g>
        );
      })}
      <text
        x={W / 2}
        y={y + 70}
        textAnchor="middle"
        fontSize={11}
        fill="var(--muted-foreground)"
      >
        {units > drawn
          ? `${meterLabel} · ${units} Einheiten insgesamt (${drawn} dargestellt)`
          : `${meterLabel} · ${units} Einheiten`}
        {interval ? " · 15-Minuten-Werte" : ""}
      </text>
    </g>
  );
}

export function MesskonzeptTopology({
  result,
  units,
}: {
  result: MesskonzeptResult;
  units: number;
}) {
  const hasStorage = useMemo(
    () => result.meters.some((m) => m.code === "speicherzaehler"),
    [result.meters],
  );

  if (result.variant === "not_determinable") return null;

  const gridBar = { x: 60, y: 24, w: W - 120, h: 46 };
  const plant = { x: 60, y: 190, w: 150, h: 62 };
  const storage = { x: W - 210, y: 190, w: 150, h: 62 };

  const caption =
    result.variant === "summenzaehler"
      ? "Alle Einheiten hinter einem Netzanschlusspunkt. Der Zweirichtungszähler misst Bezug und Einspeisung der Liegenschaft, die Unterzähler den Verbrauch je Einheit."
      : result.variant === "einzelzaehler"
        ? "Jede Einheit ist einzeln ans Netz angeschlossen und wird an ihrem eigenen Netzanschlusspunkt gemessen."
        : "Die Teilnehmer liegen an verschiedenen Netzanschlusspunkten. Die Zuordnung erfolgt rechnerisch aus viertelstündlichen Messwerten.";

  return (
    <figure className="overflow-hidden rounded-[20px] border border-border/60 bg-background/70">
      <div
        className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        tabIndex={0}
        role="region"
        aria-label="Schema des Messkonzepts, horizontal scrollbar"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Schema: ${result.variantLabel}`}
          className="h-auto w-full min-w-[38rem]"
        >
          {/* Public grid */}
          <Node
            x={gridBar.x}
            y={gridBar.y}
            w={gridBar.w}
            h={gridBar.h}
            tone="grid"
            title="Öffentliches Netz"
          />

          {/* PV plant, always with its own generation meter */}
          <Node x={plant.x} y={plant.y} w={plant.w} h={plant.h} tone="plant" title="PV-Anlage" />

          {hasStorage ? (
            <Node
              x={storage.x}
              y={storage.y}
              w={storage.w}
              h={storage.h}
              tone="storage"
              title="Speicher"
            />
          ) : null}

          {result.variant === "summenzaehler" ? (
            <>
              {/* Grid → summation meter → house bus */}
              <Wire d={`M ${W / 2} ${gridBar.y + gridBar.h} L ${W / 2} ${112}`} />
              <Meter x={W / 2} y={127} label="Zweirichtungszähler" bidirectional />
              <Wire d={`M ${W / 2} ${142} L ${W / 2} ${221}`} />

              {/* House bus */}
              <Wire d={`M ${plant.x + plant.w + 60} 221 L ${W - plant.x - plant.w - 60} 221`} />
              <text
                x={W / 2 + 175}
                y={212}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                Kundenanlage
              </text>

              {/* Plant → generation meter → bus */}
              <Wire d={`M ${plant.x + plant.w} 221 L ${plant.x + plant.w + 45} 221`} />
              <Meter x={plant.x + plant.w + 45} y={221} label="Erzeugung" />

              {hasStorage ? (
                <>
                  <Wire d={`M ${storage.x - 45} 221 L ${storage.x} 221`} />
                  <Meter x={storage.x - 45} y={221} label="Ein-/Ausspeicherung" bidirectional />
                </>
              ) : null}

              <UnitRow units={units} y={300} meterLabel="Unterzähler" interval={false} connectTo={221} />
            </>
          ) : null}

          {result.variant === "einzelzaehler" ? (
            <>
              {/* Plant feeds the grid through its own meter */}
              <Wire d={`M ${plant.x + plant.w / 2} ${plant.y} L ${plant.x + plant.w / 2} ${146}`} />
              <Meter x={plant.x + plant.w / 2} y={131} label="Erzeugung" />
              <Wire
                d={`M ${plant.x + plant.w / 2} ${116} L ${plant.x + plant.w / 2} ${gridBar.y + gridBar.h}`}
              />

              {hasStorage ? (
                <>
                  <Wire d={`M ${storage.x + storage.w / 2} ${storage.y} L ${storage.x + storage.w / 2} ${146}`} />
                  <Meter x={storage.x + storage.w / 2} y={131} label="Speicher" bidirectional />
                  <Wire
                    d={`M ${storage.x + storage.w / 2} ${116} L ${storage.x + storage.w / 2} ${gridBar.y + gridBar.h}`}
                  />
                </>
              ) : null}

              <UnitRow
                units={units}
                y={300}
                meterLabel="Entnahmezähler je Einheit"
                interval={false}
                connectTo={gridBar.y + gridBar.h}
              />
            </>
          ) : null}

          {result.variant === "viertelstunden_bilanzierung" ? (
            <>
              <Wire d={`M ${plant.x + plant.w / 2} ${plant.y} L ${plant.x + plant.w / 2} ${146}`} />
              <Meter x={plant.x + plant.w / 2} y={131} label="Erzeugung" interval />
              <Wire
                d={`M ${plant.x + plant.w / 2} ${116} L ${plant.x + plant.w / 2} ${gridBar.y + gridBar.h}`}
              />

              {hasStorage ? (
                <>
                  <Wire d={`M ${storage.x + storage.w / 2} ${storage.y} L ${storage.x + storage.w / 2} ${146}`} />
                  <Meter x={storage.x + storage.w / 2} y={131} label="Speicher" bidirectional interval />
                  <Wire
                    d={`M ${storage.x + storage.w / 2} ${116} L ${storage.x + storage.w / 2} ${gridBar.y + gridBar.h}`}
                  />
                </>
              ) : null}

              {/* The allocation itself is a calculation, not a wire. */}
              <Wire
                d={`M ${plant.x + plant.w / 2} ${plant.y + plant.h / 2} C ${W / 2} ${plant.y + 120}, ${W / 2} ${plant.y + 120}, ${W / 2} ${252}`}
                dashed
                label={{ x: W / 2 + 130, y: plant.y + 96, text: "rechnerische Zuordnung je Viertelstunde" }}
              />

              <UnitRow
                units={units}
                y={300}
                meterLabel="Teilnehmer mit Zählerstandsgangmessung"
                interval
                connectTo={gridBar.y + gridBar.h}
              />
            </>
          ) : null}
        </svg>
      </div>
      <figcaption className="border-t border-border/50 px-5 py-3 text-xs leading-6 text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

export default MesskonzeptTopology;
