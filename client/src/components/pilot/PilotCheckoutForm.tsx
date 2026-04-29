import { FormEvent, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createPilotCheckout,
  getPilotOfferContent,
  type PilotApiError,
  type PilotOfferCode,
} from "@/lib/pilot-api";

type PilotCheckoutFormProps = {
  selectedOfferCode: PilotOfferCode;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  organization: string;
  location: string;
  projectType: string;
  privacyPolicyAccepted: boolean;
  pilotTermsAccepted: boolean;
  marketingConsent: boolean;
};

const initialFormState: FormState = {
  name: "",
  email: "",
  phone: "",
  organization: "",
  location: "",
  projectType: "gebaeude",
  privacyPolicyAccepted: false,
  pilotTermsAccepted: false,
  marketingConsent: false,
};

const projectTypeOptions = [
  { value: "gebaeude", label: "Gebäude oder einzelner Standort" },
  { value: "quartier", label: "Quartier oder Areal" },
  { value: "portfolio", label: "Portfolio oder Mehrstandort-Konstellation" },
  { value: "kommunal", label: "Kommunale oder institutionelle Konstellation" },
  { value: "infrastruktur", label: "Betriebs- oder Infrastrukturvorhaben" },
];

function getFriendlyErrorMessage(error: unknown) {
  const fallback = "Die Checkout-Erstellung konnte nicht abgeschlossen werden. Bitte prüfen Sie die Angaben und versuchen Sie es erneut.";

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  const apiError = error as PilotApiError | undefined;
  if (apiError?.message) {
    return apiError.message;
  }

  return fallback;
}

export function PilotCheckoutForm({ selectedOfferCode }: PilotCheckoutFormProps) {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedOffer = useMemo(() => getPilotOfferContent(selectedOfferCode), [selectedOfferCode]);

  function updateField<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function validateForm() {
    if (!form.name.trim()) {
      return "Bitte geben Sie einen Ansprechpartner an.";
    }
    if (!form.email.trim()) {
      return "Bitte geben Sie eine E-Mail-Adresse an.";
    }
    if (!form.location.trim()) {
      return "Bitte geben Sie den Projektstandort oder die Region an.";
    }
    if (!form.projectType.trim()) {
      return "Bitte wählen Sie einen Projekttyp aus.";
    }
    if (!form.privacyPolicyAccepted || !form.pilotTermsAccepted) {
      return "Bitte bestätigen Sie Datenschutz und Pilotbedingungen, bevor der Checkout gestartet wird.";
    }
    return "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const validationMessage = validateForm();
    if (validationMessage) {
      setErrorMessage(validationMessage);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createPilotCheckout({
        offerCode: selectedOfferCode,
        projectType: form.projectType,
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        organization: form.organization || undefined,
        location: form.location || undefined,
        legalAcceptances: {
          privacyPolicyAccepted: form.privacyPolicyAccepted,
          pilotTermsAccepted: form.pilotTermsAccepted,
          marketingConsent: form.marketingConsent,
        },
      });

      window.location.href = result.checkoutUrl;
    } catch (error) {
      setErrorMessage(getFriendlyErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-[32px] border border-border/70 bg-card p-6 shadow-[0_18px_60px_rgba(18,32,27,0.08)] sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-primary">Pilot Checkout</p>
            <h3 className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Bezahlt starten statt unverbindlich anfragen.
            </h3>
            <p className="text-base leading-8 text-muted-foreground">
              Sie wählen das passende Paket, übermitteln die operative Ausgangslage und werden direkt in die bezahlte Pilotaufnahme geführt.
            </p>
          </div>

          <div className="rounded-[28px] border border-primary/15 bg-primary/6 p-5">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">Ausgewähltes Paket</p>
            <h4 className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
              {selectedOffer.title}
            </h4>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{selectedOffer.subtitle}</p>
          </div>

          <div className="space-y-3 rounded-[28px] border border-border/70 bg-background/70 p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm leading-6 text-foreground/90">
                Der Checkout verwendet serverseitig gesteuerte Produkte. Preise und Berechtigungen werden nicht im Browser festgelegt.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm leading-6 text-foreground/90">
                Nach erfolgreicher Zahlung werden strukturierte Intake-Schritte und Dokumentenuploads für Ihr Pilotprojekt freigeschaltet.
              </p>
            </div>
          </div>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Ansprechpartner</span>
              <input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition-colors focus:border-primary"
                placeholder="Vor- und Nachname"
                autoComplete="name"
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>E-Mail</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition-colors focus:border-primary"
                placeholder="name@unternehmen.de"
                autoComplete="email"
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Organisation</span>
              <input
                value={form.organization}
                onChange={(event) => updateField("organization", event.target.value)}
                className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition-colors focus:border-primary"
                placeholder="Unternehmen, Kommune oder Projektgesellschaft"
                autoComplete="organization"
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Telefon</span>
              <input
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition-colors focus:border-primary"
                placeholder="Optional"
                autoComplete="tel"
              />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-[1.2fr_0.8fr]">
            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Standort / Region</span>
              <input
                value={form.location}
                onChange={(event) => updateField("location", event.target.value)}
                className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition-colors focus:border-primary"
                placeholder="z. B. Frankfurt am Main, Rhein-Main, Hessen"
                autoComplete="address-level2"
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Projekttyp</span>
              <select
                value={form.projectType}
                onChange={(event) => updateField("projectType", event.target.value)}
                className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition-colors focus:border-primary"
              >
                {projectTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3 rounded-[26px] border border-border/70 bg-background/70 p-5">
            <label className="flex items-start gap-3 text-sm leading-6 text-foreground/90">
              <input
                type="checkbox"
                checked={form.privacyPolicyAccepted}
                onChange={(event) => updateField("privacyPolicyAccepted", event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span>Ich bestätige, dass die übermittelten Angaben für die Pilotaufnahme verarbeitet werden dürfen.</span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-6 text-foreground/90">
              <input
                type="checkbox"
                checked={form.pilotTermsAccepted}
                onChange={(event) => updateField("pilotTermsAccepted", event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span>Ich bestätige, dass ich die bezahlte Pilotanfrage bewusst starte und die Projektgrundlage belastbar beschreiben kann.</span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
              <input
                type="checkbox"
                checked={form.marketingConsent}
                onChange={(event) => updateField("marketingConsent", event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span>Optional: Ich möchte Informationen zu weiteren Pilot- und Strukturierungsangeboten erhalten.</span>
            </label>
          </div>

          {errorMessage ? (
            <div className="flex items-start gap-3 rounded-[22px] border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-muted-foreground">
              Nach dem Klick wird ein sicherer Checkout gestartet. Erst danach folgen strukturierte Intake- und Dokumentenschritte.
            </p>
            <Button type="submit" size="lg" className="rounded-full px-6" disabled={isSubmitting}>
              {isSubmitting ? "Checkout wird vorbereitet…" : "Bezahlte Pilotaufnahme starten"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
