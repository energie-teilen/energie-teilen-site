type CapacityBannerProps = {
  remaining: number;
  monthLabel?: string;
  className?: string;
};

export function CapacityBanner({
  remaining,
  monthLabel = "diesem Monat",
  className = "",
}: CapacityBannerProps) {
  const safeRemaining = Math.max(0, Math.floor(remaining));
  const remainingLabel = safeRemaining === 1 ? "Pilot-Slot" : "Pilot-Slots";

  return (
    <div
      className={`rounded-[28px] border border-primary/15 bg-[linear-gradient(135deg,rgba(29,73,58,0.08),rgba(199,146,54,0.08))] p-4 sm:p-5 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-primary/80">Pilot-Kapazität</p>
          <p className="text-base leading-7 text-foreground sm:text-lg">
            <span className="font-semibold text-foreground">{safeRemaining} {remainingLabel}</span> stehen in {monthLabel} für
            neue bezahlte Erstaufnahmen zur Verfügung.
          </p>
        </div>
        <div className="rounded-full border border-primary/15 bg-background/80 px-4 py-2 text-sm text-muted-foreground">
          Reihenfolge nach abgeschlossenem Checkout
        </div>
      </div>
    </div>
  );
}
