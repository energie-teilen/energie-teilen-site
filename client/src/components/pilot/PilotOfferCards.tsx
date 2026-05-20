import { ArrowRight, CheckCircle2, Loader2, Lock, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  getPilotOfferOptions,
  type PilotOfferCode,
} from "@/lib/pilot-api";

/**
 * PilotOfferCards
 *
 * Upgrades over the previous version:
 *   - Whole card is keyboard- and click-selectable (role="radio" inside a
 *     role="radiogroup"), not just the bottom button. Comparing offers no
 *     longer scrolls the user away.
 *   - The "Empfohlener Standard" (et_structuring) tier gets stronger visual
 *     emphasis without changing the brand language.
 *   - A subtle lock indicator confirms that the actual price lives on the
 *     server and appears only inside Stripe Checkout — reduces hesitation
 *     without violating the no-client-side-pricing rule.
 *   - `isSubmitting` prop now drives a real loading state with a spinner.
 *   - Checkmark animates in via framer-motion so selection feels deliberate.
 *   - Keyboard handlers (Enter / Space) on each card mirror the click.
 *   - aria attributes ready for screen readers.
 *
 * Public API is unchanged — drop-in replacement.
 */

type PilotOfferCardsProps = {
  selectedOfferCode: PilotOfferCode;
  onSelectOffer: (offerCode: PilotOfferCode) => void;
  onProceed?: () => void;
  isSubmitting?: boolean;
};

const RECOMMENDED_OFFER: PilotOfferCode = "et_structuring";

export function PilotOfferCards({
  selectedOfferCode,
  onSelectOffer,
  onProceed,
  isSubmitting = false,
}: PilotOfferCardsProps) {
  const offers = getPilotOfferOptions();

  function handleSelect(offerCode: PilotOfferCode) {
    if (isSubmitting) return;
    onSelectOffer(offerCode);
  }

  function handleProceedClick(
    e: React.MouseEvent,
    offerCode: PilotOfferCode,
  ) {
    e.stopPropagation();
    if (isSubmitting) return;
    onSelectOffer(offerCode);
    onProceed?.();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Pilotstufe auswählen"
      className="grid gap-5 xl:grid-cols-3"
    >
      {offers.map((offer) => {
        const isSelected = offer.offerCode === selectedOfferCode;
        const isRecommended = offer.offerCode === RECOMMENDED_OFFER;

        return (
          <motion.article
            key={offer.offerCode}
            role="radio"
            aria-checked={isSelected}
            aria-label={`${offer.title} — ${offer.subtitle}`}
            tabIndex={0}
            onClick={() => handleSelect(offer.offerCode)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSelect(offer.offerCode);
              }
            }}
            initial={false}
            animate={{ scale: isSelected ? 1.0 : 1.0 }}
            whileHover={{ y: isSubmitting ? 0 : -2 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className={[
              // base
              "relative cursor-pointer select-none rounded-[30px] border bg-card p-6",
              "shadow-[0_16px_48px_rgba(18,32,27,0.08)] transition-colors duration-300",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
              // selected vs unselected
              isSelected
                ? "border-primary/45 ring-2 ring-primary/12"
                : "border-border/70 hover:border-primary/25",
              // recommended emphasis (subtle, only when NOT selected so it doesn't fight the ring)
              !isSelected && isRecommended ? "border-primary/30" : "",
              // disabled when submitting
              isSubmitting ? "cursor-not-allowed opacity-70" : "",
            ].join(" ")}
          >
            {/* "Empfohlen" ribbon for the recommended tier */}
            {isRecommended ? (
              <div className="absolute -top-3 left-6 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-primary-foreground shadow-[0_6px_16px_rgba(29,73,58,0.25)]">
                <Sparkles className="h-3 w-3" />
                Empfohlen
              </div>
            ) : null}

            <div className="flex min-h-full flex-col gap-5">
              {/* HEADER */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
                    {offer.badge}
                  </span>
                  <AnimatePresence mode="wait">
                    {isSelected ? (
                      <motion.span
                        key="check"
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </div>
                <div className="space-y-2">
                  <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
                    {offer.title}
                  </h3>
                  <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                    {offer.subtitle}
                  </p>
                </div>
              </div>

              {/* OUTCOMES */}
              <div className="space-y-3">
                {offer.outcomes.map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 text-sm leading-6 text-foreground/90"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              {/* FOOTER */}
              <div className="mt-auto space-y-4 pt-2">
                <div className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Ideal für
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground/90">
                    {offer.idealFor}
                  </p>
                </div>

                {/* Pricing trust signal — no number, server-driven */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  <span>Preis erscheint im sicheren Stripe-Checkout</span>
                </div>

                <Button
                  type="button"
                  variant={isSelected ? "default" : "outline"}
                  className="w-full rounded-full"
                  disabled={isSubmitting}
                  onClick={(e) => handleProceedClick(e, offer.offerCode)}
                  aria-label={
                    isSelected
                      ? `Mit ${offer.title} fortfahren`
                      : `${offer.title} auswählen und fortfahren`
                  }
                >
                  {isSubmitting && isSelected ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Wird vorbereitet…
                    </>
                  ) : isSelected ? (
                    <>
                      Mit diesem Paket fortfahren
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Dieses Paket wählen
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </motion.article>
        );
      })}
    </div>
  );
}
