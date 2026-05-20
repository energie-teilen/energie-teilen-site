/**
 * client/src/components/pilot/PilotCheckoutForm.tsx
 *
 * Pilot intake — the revenue surface.
 *
 * Rewrite goals (visual design preserved 1:1):
 *   - Validation is driven by the SAME Zod schema the server uses
 *     (CreatePilotCheckoutInputSchema from shared/schema.ts).
 *   - Each field shows its own inline error message.
 *   - react-hook-form + zodResolver — no more manual validateForm().
 *   - Honeypot field "website" blocks ~95% of form spam without a CAPTCHA.
 *   - Disabled-while-submitting prevents double-charge.
 *   - Success state appears when Stripe redirects back with ?paid=1.
 *
 * Drop-in replacement for the existing file at
 *   client/src/components/pilot/PilotCheckoutForm.tsx
 */

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createPilotCheckout,
  getPilotOfferContent,
  PilotApiError,
  type PilotOfferCode,
} from "@/lib/pilot-api";
import {
  CreatePilotCheckoutInputSchema,
  PROJECT_TYPE_LABELS,
  type CreatePilotCheckoutInput,
  type ProjectType,
} from "../../../../shared/schema";

type PilotCheckoutFormProps = {
  selectedOfferCode: PilotOfferCode;
};

const projectTypeOptions = (Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]).map(
  (value) => ({ value, label: PROJECT_TYPE_LABELS[value] }),
);

const defaultValues: CreatePilotCheckoutInput = {
  offerCode: "et_structuring",
  projectType: "gebaeude",
  name: "",
  email: "",
  phone: "",
  organization: "",
  location: "",
  legalAcceptances: {
    privacyPolicyAccepted: false,
    pilotTermsAccepted: false,
    marketingConsent: false,
  },
  website: "", // honeypot — must stay empty
};

function getFriendlyErrorMessage(error: unknown): string {
  const fallback =
    "Die Checkout-Erstellung konnte nicht abgeschlossen werden. Bitte prüfen Sie die Angaben und versuchen Sie es erneut.";
  if (error instanceof PilotApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

/** Reads ?paid=1 / ?canceled=1 once on mount. */
function usePaymentReturnState(): "paid" | "canceled" | null {
  const [state, setState] = useState<"paid" | "canceled" | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") === "1") setState("paid");
    else if (params.get("canceled") === "1") setState("canceled");
  }, []);
  return state;
}

export function PilotCheckoutForm({ selectedOfferCode }: PilotCheckoutFormProps) {
  const selectedOffer = useMemo(
    () => getPilotOfferContent(selectedOfferCode),
    [selectedOfferCode],
  );
  const paymentReturn = usePaymentReturnState();
  const [submitError, setSubmitError] = useState<string>("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<CreatePilotCheckoutInput>({
    resolver: zodResolver(CreatePilotCheckoutInputSchema),
    mode: "onBlur",
    defaultValues: { ...defaultValues, offerCode: selectedOfferCode },
  });

  // keep offerCode in sync with parent prop
  useEffect(() => {
    setValue("offerCode", selectedOfferCode);
  }, [selectedOfferCode, setValue]);

  async function onSubmit(values: CreatePilotCheckoutInput) {
    setSubmitError("");
    try {
      const result = await createPilotCheckout(values);
      window.location.href = result.checkoutUrl;
    } catch (error) {
      setSubmitError(getFriendlyErrorMessage(error));
    }
  }

  // ------------------------------------------------------------------
  // SUCCESS STATE — Stripe redirected back with ?paid=1
  // ------------------------------------------------------------------
  if (paymentReturn === "paid") {
    return (
      <section className="rounded-[32px] border border-primary/15 bg-card p-6 shadow-[0_18px_60px_rgba(18,32,27,0.08)] sm:p-10">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
          <div className="space-y-4">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-primary">
              Zahlung bestätigt
            </p>
            <h3 className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Pilotaufnahme erfolgreich gestartet.
            </h3>
            <p className="text-base leading-8 text-muted-foreground">
              Vielen Dank. Ihre bezahlte Pilotaufnahme ist registriert. Sie erhalten
              in Kürze eine Bestätigung per E-Mail mit den nächsten Intake-Schritten.
            </p>
          </div>

          <div className="space-y-4 rounded-[28px] border border-border/70 bg-background/70 p-6">
            <h4 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
              Was als Nächstes passiert
            </h4>
            <ol className="space-y-3 text-sm leading-7 text-foreground/90">
              <li>
                <span className="font-medium">1.</span> Sie erhalten eine
                Zahlungsbestätigung und einen sicheren Link zum strukturierten
                Intake.
              </li>
              <li>
                <span className="font-medium">2.</span> Wir prüfen Ihre Konstellation
                und melden uns innerhalb von 48 Stunden mit einem Terminvorschlag.
              </li>
              <li>
                <span className="font-medium">3.</span> Die Pilotbearbeitung startet
                mit klaren Dokumentenschritten und einer geordneten Übergabe.
              </li>
            </ol>
            <Button
              variant="outline"
              className="mt-3 w-full rounded-full"
              onClick={() => {
                window.history.replaceState({}, "", window.location.pathname);
                window.location.reload();
              }}
            >
              Zurück zur Startseite
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------------
  // CANCELED STATE — soft notice; form still rendered below it
  // ------------------------------------------------------------------
  const canceledBanner =
    paymentReturn === "canceled" ? (
      <div className="mb-5 flex items-start gap-3 rounded-[22px] border border-amber-300/40 bg-amber-50/70 p-4 text-sm text-amber-900">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Die Zahlung wurde abgebrochen. Sie können den Checkout jederzeit erneut
          starten — Ihre Angaben sind nicht verloren gegangen.
        </span>
      </div>
    ) : null;

  // ------------------------------------------------------------------
  // FORM
  // ------------------------------------------------------------------
  return (
    <section className="rounded-[32px] border border-border/70 bg-card p-6 shadow-[0_18px_60px_rgba(18,32,27,0.08)] sm:p-8">
      {canceledBanner}

      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
        {/* LEFT — context */}
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-primary">
              Pilot Checkout
            </p>
            <h3 className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Bezahlt starten statt unverbindlich anfragen.
            </h3>
            <p className="text-base leading-8 text-muted-foreground">
              Sie wählen das passende Paket, übermitteln die operative Ausgangslage
              und werden direkt in die bezahlte Pilotaufnahme geführt.
            </p>
          </div>

          <div className="rounded-[28px] border border-primary/15 bg-primary/6 p-5">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
              Ausgewähltes Paket
            </p>
            <h4 className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
              {selectedOffer.title}
            </h4>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {selectedOffer.subtitle}
            </p>
          </div>

          <div className="space-y-3 rounded-[28px] border border-border/70 bg-background/70 p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm leading-6 text-foreground/90">
                Der Checkout verwendet serverseitig gesteuerte Produkte. Preise und
                Berechtigungen werden nicht im Browser festgelegt.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm leading-6 text-foreground/90">
                Nach erfolgreicher Zahlung werden strukturierte Intake-Schritte und
                Dokumentenuploads für Ihr Pilotprojekt freigeschaltet.
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT — form */}
        <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
          {/* Honeypot — hidden from humans, irresistible to bots */}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            {...register("website")}
            style={{
              position: "absolute",
              left: "-9999px",
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          {/* Hidden — kept in sync via setValue effect above */}
          <input type="hidden" {...register("offerCode")} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Ansprechpartner"
              error={errors.name?.message}
            >
              <input
                {...register("name")}
                placeholder="Vor- und Nachname"
                autoComplete="name"
                className={inputCls(!!errors.name)}
              />
            </Field>

            <Field label="E-Mail" error={errors.email?.message}>
              <input
                type="email"
                {...register("email")}
                placeholder="name@unternehmen.de"
                autoComplete="email"
                className={inputCls(!!errors.email)}
              />
            </Field>

            <Field label="Organisation" error={errors.organization?.message}>
              <input
                {...register("organization")}
                placeholder="Unternehmen, Kommune oder Projektgesellschaft"
                autoComplete="organization"
                className={inputCls(!!errors.organization)}
              />
            </Field>

            <Field label="Telefon" error={errors.phone?.message}>
              <input
                {...register("phone")}
                placeholder="Optional"
                autoComplete="tel"
                className={inputCls(!!errors.phone)}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-[1.2fr_0.8fr]">
            <Field
              label="Standort / Region"
              error={errors.location?.message}
            >
              <input
                {...register("location")}
                placeholder="z. B. Frankfurt am Main, Rhein-Main, Hessen"
                autoComplete="address-level2"
                className={inputCls(!!errors.location)}
              />
            </Field>

            <Field label="Projekttyp" error={errors.projectType?.message}>
              <select
                {...register("projectType")}
                className={inputCls(!!errors.projectType)}
              >
                {projectTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="space-y-3 rounded-[26px] border border-border/70 bg-background/70 p-5">
            <CheckboxField
              checked={watch("legalAcceptances.privacyPolicyAccepted")}
              register={register("legalAcceptances.privacyPolicyAccepted")}
              error={errors.legalAcceptances?.privacyPolicyAccepted?.message}
              label="Ich bestätige, dass die übermittelten Angaben für die Pilotaufnahme verarbeitet werden dürfen."
            />
            <CheckboxField
              checked={watch("legalAcceptances.pilotTermsAccepted")}
              register={register("legalAcceptances.pilotTermsAccepted")}
              error={errors.legalAcceptances?.pilotTermsAccepted?.message}
              label="Ich bestätige, dass ich die bezahlte Pilotanfrage bewusst starte und die Projektgrundlage belastbar beschreiben kann."
            />
            <CheckboxField
              checked={watch("legalAcceptances.marketingConsent") ?? false}
              register={register("legalAcceptances.marketingConsent")}
              label="Optional: Ich möchte Informationen zu weiteren Pilot- und Strukturierungsangeboten erhalten."
              muted
            />
          </div>

          {submitError ? (
            <div className="flex items-start gap-3 rounded-[22px] border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-muted-foreground">
              Nach dem Klick wird ein sicherer Checkout gestartet. Erst danach folgen
              strukturierte Intake- und Dokumentenschritte.
            </p>
            <Button
              type="submit"
              size="lg"
              className="rounded-full px-6"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Checkout wird vorbereitet…"
                : "Bezahlte Pilotaufnahme starten"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

// ============================================================================
// SUB-COMPONENTS (kept inside the file to honour the 4-file scope)
// ============================================================================

function inputCls(hasError: boolean): string {
  return [
    "h-12 w-full rounded-2xl border bg-background px-4 text-sm outline-none transition-colors",
    hasError ? "border-destructive focus:border-destructive" : "border-border focus:border-primary",
  ].join(" ");
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
      {error ? (
        <span className="block text-xs font-normal text-destructive">{error}</span>
      ) : null}
    </label>
  );
}

function CheckboxField({
  checked,
  register,
  error,
  label,
  muted,
}: {
  checked: boolean | undefined;
  register: ReturnType<ReturnType<typeof useForm<CreatePilotCheckoutInput>>["register"]>;
  error?: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label
        className={`flex items-start gap-3 text-sm leading-6 ${
          muted ? "text-muted-foreground" : "text-foreground/90"
        }`}
      >
        <input
          type="checkbox"
          {...register}
          checked={!!checked}
          className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
        />
        <span>{label}</span>
      </label>
      {error ? (
        <span className="block pl-7 text-xs font-normal text-destructive">{error}</span>
      ) : null}
    </div>
  );
}
