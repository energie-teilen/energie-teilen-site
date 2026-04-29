import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPilotOfferOptions, type PilotOfferCode } from "@/lib/pilot-api";

type PilotOfferCardsProps = {
  selectedOfferCode: PilotOfferCode;
  onSelectOffer: (offerCode: PilotOfferCode) => void;
  onProceed?: () => void;
  isSubmitting?: boolean;
};

export function PilotOfferCards({
  selectedOfferCode,
  onSelectOffer,
  onProceed,
  isSubmitting = false,
}: PilotOfferCardsProps) {
  const offers = getPilotOfferOptions();

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      {offers.map((offer) => {
        const isSelected = offer.offerCode === selectedOfferCode;

        return (
          <article
            key={offer.offerCode}
            className={[
              "rounded-[30px] border bg-card p-6 shadow-[0_16px_48px_rgba(18,32,27,0.08)] transition-all duration-300",
              isSelected ? "border-primary/45 ring-2 ring-primary/12" : "border-border/70 hover:border-primary/20",
            ].join(" ")}
          >
            <div className="flex min-h-full flex-col gap-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
                    {offer.badge}
                  </span>
                  {isSelected ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}
                </div>
                <div className="space-y-2">
                  <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">{offer.title}</h3>
                  <p className="text-sm leading-7 text-muted-foreground sm:text-base">{offer.subtitle}</p>
                </div>
              </div>

              <div className="space-y-3">
                {offer.outcomes.map((item) => (
                  <div key={item} className="flex items-start gap-3 text-sm leading-6 text-foreground/90">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              <div className="mt-auto space-y-4 pt-2">
                <div className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">Ideal für</p>
                  <p className="mt-2 text-sm leading-6 text-foreground/90">{offer.idealFor}</p>
                </div>

                <Button
                  type="button"
                  variant={isSelected ? "default" : "outline"}
                  className="w-full rounded-full"
                  disabled={isSubmitting}
                  onClick={() => {
                    onSelectOffer(offer.offerCode);
                    onProceed?.();
                  }}
                >
                  {isSelected ? "Ausgewählt" : "Dieses Paket wählen"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
