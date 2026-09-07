import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import {
  billPeriod,
  formatEur,
  reconcile,
  type BillingResult,
} from "../../../shared/billing";
import type { AllocationResult } from "../../../shared/allocation";
import type { MieterstromInputs } from "../../../shared/schema";

/**
 * BillingPreview
 *
 * What the allocation is worth to one household over a year.
 *
 * The chain is the point: the metering concept says how it is measured, the
 * allocation says who took which kilowatt-hour, and this says what they pay
 * for it. Same engines the API runs.
 *
 * The saving against basic supply needs the local basic-supply price, which
 * only the visitor has. Until it is entered the comparison is shown as
 * undecidable rather than filled in with a plausible number.
 */

/** One illustrative day scaled to a year. Stated, never applied silently. */
const ANNUALISATION_NOTE_DE =
  "Jahreswerte sind der Beispieltag hochgerechnet (× 365). Für eine belastbare Abrechnung treten die gemessenen Jahresmengen an diese Stelle.";

const PERIOD = { from: "2026-01-01", to: "2027-01-01" };
const DAYS_PER_YEAR = 365;

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        strong ? "border-t border-border/60 pt-2.5" : ""
      }`}
    >
      <span className={`text-sm leading-6 ${muted ? "text-muted-foreground" : "text-foreground/90"}`}>
        {label}
      </span>
      <span
        className={`shrink-0 tabular-nums ${
          strong ? "font-display text-base font-semibold text-foreground" : "text-sm text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function BillingPreview({
  inputs,
  run,
}: {
  inputs: MieterstromInputs;
  run: AllocationResult;
}) {
  // The visitor's own numbers. Empty means unknown, and unknown is reported.
  const [reststrom, setReststrom] = useState<string>("");
  const [grundversorgung, setGrundversorgung] = useState<string>("");

  const reststromCt = reststrom === "" ? inputs.strompreisMieterCtPerKwh : Number(reststrom);
  const grundversorgungCt = grundversorgung === "" ? undefined : Number(grundversorgung);

  const result: BillingResult | null = useMemo(() => {
    const first = run.participants[0];
    if (!first) return null;
    if (!Number.isFinite(reststromCt) || reststromCt < 0) return null;
    if (grundversorgungCt !== undefined && (!Number.isFinite(grundversorgungCt) || grundversorgungCt < 0)) {
      return null;
    }

    try {
      return billPeriod({
        period: PERIOD,
        tariff: {
          mieterstromCtPerKwh: inputs.strompreisMieterCtPerKwh,
          reststromCtPerKwh: reststromCt,
          grundpreisEurPerYear: 120,
          grundversorgungCtPerKwh: grundversorgungCt,
        },
        participants: [
          {
            id: first.id,
            label: first.label ?? undefined,
            allocatedKwh: first.allocatedKwh * DAYS_PER_YEAR,
            gridDrawKwh: first.gridDrawKwh * DAYS_PER_YEAR,
          },
        ],
      });
    } catch {
      return null;
    }
  }, [run, inputs.strompreisMieterCtPerKwh, reststromCt, grundversorgungCt]);

  if (!result) return null;

  const s = result.statements[0];
  const balanced = reconcile(result).ok;
  const saving = s.savingVsGrundversorgungCents;

  return (
    <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
      <p className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        <Receipt className="h-3.5 w-3.5" />
        Abrechnungsvorschau · {s.label ?? s.id} · ein Jahr
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {/* The statement itself */}
        <div className="space-y-2.5">
          {s.lines.map((l) => (
            <Row
              key={l.code}
              label={
                <>
                  {l.label}
                  <span className="text-muted-foreground">
                    {" "}
                    · {l.quantity.toLocaleString("de-DE", { maximumFractionDigits: 0 })} {l.unit}
                    {l.unit === "kWh"
                      ? ` × ${l.unitPriceCt.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ct`
                      : ""}
                  </span>
                </>
              }
              value={formatEur(l.netCents)}
            />
          ))}
          <Row label="Netto" value={formatEur(s.netCents)} muted />
          <Row
            label={`Umsatzsteuer ${(result.vatRate * 100).toLocaleString("de-DE")} %`}
            value={formatEur(s.vatCents)}
            muted
          />
          <Row label="Gesamtbetrag brutto" value={formatEur(s.grossCents)} strong />
          {balanced ? (
            <p className="pt-1 text-[0.68rem] text-muted-foreground">
              Positionen und Summe stimmen auf den Cent überein — geprüft aus dem Ergebnis heraus.
            </p>
          ) : null}
        </div>

        {/* The two numbers only the visitor has */}
        <div className="space-y-4">
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Reststrompreis
              </span>
              <span className="relative block">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={reststrom}
                  placeholder={inputs.strompreisMieterCtPerKwh.toFixed(1)}
                  onChange={(e) => setReststrom(e.target.value)}
                  className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 pr-16 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  ct/kWh
                </span>
              </span>
            </label>

            <label className="block space-y-1.5">
              <span className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Grundversorgung
              </span>
              <span className="relative block">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={grundversorgung}
                  placeholder="unbekannt"
                  onChange={(e) => setGrundversorgung(e.target.value)}
                  className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 pr-16 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  ct/kWh
                </span>
              </span>
            </label>
          </div>

          {saving === null ? (
            <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
              <p className="text-sm leading-6 text-foreground/90">
                Ersparnis gegenüber der Grundversorgung:{" "}
                <span className="font-medium">nicht bestimmbar</span>
              </p>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                Dafür fehlt der örtliche Grundversorgungstarif. Ein Wert genügt — er wird nicht
                geschätzt, weil er je Netzgebiet unterschiedlich ist.
              </p>
            </div>
          ) : (
            <div
              className={`rounded-2xl border p-4 ${
                saving >= 0
                  ? "border-primary/30 bg-primary/6"
                  : "border-amber-500/30 bg-amber-500/6"
              }`}
            >
              <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {saving >= 0 ? "Ersparnis je Haushalt und Jahr" : "Mehrkosten je Haushalt und Jahr"}
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
                {formatEur(Math.abs(saving))}
              </p>
              {result.priceCap.capCtPerKwh !== null ? (
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  Vergleichswert für den Arbeitspreis aus diesem Tarif:{" "}
                  {result.priceCap.capCtPerKwh.toLocaleString("de-DE", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  ct/kWh — angesetzt sind{" "}
                  {inputs.strompreisMieterCtPerKwh.toLocaleString("de-DE", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  ct/kWh.
                </p>
              ) : null}
            </div>
          )}

          {result.warnings
            .filter((w) => w.code === "price_over_cap")
            .map((w) => (
              <p key={w.code} className="text-xs leading-6 text-amber-700">
                {w.message}
              </p>
            ))}
        </div>
      </div>

      <p className="mt-4 text-[0.68rem] leading-6 text-muted-foreground">
        {ANNUALISATION_NOTE_DE} {result.conventions.join(" ")} {result.disclaimer}
      </p>
    </div>
  );
}

export default BillingPreview;
