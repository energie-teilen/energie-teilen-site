import type { ReactNode } from "react";

/**
 * The small input cluster each standalone tool page needs.
 *
 * The tools were previously reachable only from the calculator's own state.
 * On their own routes they need to be usable immediately, by someone who
 * arrived from a search result and has one question — so each page owns a
 * minimal set of inputs rather than the full economic model.
 */

export function ToolInputGrid({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-border/70 bg-card p-5 sm:p-6">
      <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Ihre Konstellation
      </p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 text-sm font-medium text-foreground"
      >
        <span>{label}</span>
        <span className="font-display text-base font-semibold tabular-nums">
          {value.toLocaleString("de-DE")}{" "}
          <span className="text-xs font-normal text-muted-foreground">{unit}</span>
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={`${value} ${unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <select
        id={id}
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
    </div>
  );
}

/** A short method note. Every tool page carries one; none of them is decorative. */
export function MethodNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[20px] border border-border/60 bg-card/60 p-6">
      <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}
