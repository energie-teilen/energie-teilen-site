import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Copy, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPilotOrder, PilotApiError, type PilotOrder } from "@/lib/pilot-api";
import { track } from "@/lib/analytics";

/**
 * PilotConfirmation
 *
 * The missing end of the paid funnel.
 *
 * Stripe's success_url returns the buyer to `/?paid=1&session_id=cs_...`. This
 * resolves that session id against GET /api/pilot-order/:sessionId and renders
 * the confirmation.
 *
 * Design rules:
 *   - The panel states what was bought, the reference, what will be produced,
 *     and the project data the customer must send back.
 *   - `responseWindow` renders only when configured server-side.
 *   - SEPA-aware: `processing` is a distinct state, not a failure.
 *   - The URL is cleaned after reading so a refresh does not replay a stale
 *     confirmation.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; order: PilotOrder }
  | { kind: "error"; message: string; reference: string | null }
  | { kind: "canceled" };

function readCheckoutParams(): { sessionId: string | null; canceled: boolean } {
  if (typeof window === "undefined") return { sessionId: null, canceled: false };
  const params = new URLSearchParams(window.location.search);
  return {
    sessionId: params.get("paid") === "1" ? params.get("session_id") : null,
    canceled: params.get("canceled") === "1",
  };
}

/** Strip the checkout params but keep the hash so the scroll anchor survives. */
function cleanUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  ["paid", "session_id", "canceled"].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

const STATUS_COPY: Record<
  PilotOrder["status"],
  { title: string; body: string; tone: "ok" | "wait" | "bad" }
> = {
  paid: {
    title: "Zahlung eingegangen — Ihre Pilotaufnahme ist angelegt",
    body: "Eine Bestätigung mit allen Angaben ist zusätzlich an Ihre E-Mail-Adresse unterwegs.",
    tone: "ok",
  },
  processing: {
    title: "Auftrag angelegt — Zahlung wird noch verarbeitet",
    body: "Bei SEPA-Lastschrift dauert die Einlösung einige Bankarbeitstage. Ihre Pilotaufnahme ist bereits registriert; die Bestätigung folgt, sobald die Zahlung eingelöst ist.",
    tone: "wait",
  },
  unpaid: {
    title: "Für diese Referenz liegt noch keine Zahlung vor",
    body: "Der Checkout wurde begonnen, aber nicht abgeschlossen. Sie können den Vorgang unten erneut starten.",
    tone: "bad",
  },
  expired: {
    title: "Dieser Checkout ist abgelaufen",
    body: "Es wurde nichts abgebucht. Starten Sie die Pilotaufnahme unten einfach neu.",
    tone: "bad",
  },
};

const TONE_CLASS = {
  ok: "border-primary/25 bg-primary/6",
  wait: "border-amber-500/30 bg-amber-500/8",
  bad: "border-destructive/25 bg-destructive/6",
} as const;

function StatusIcon({ tone }: { tone: "ok" | "wait" | "bad" }) {
  if (tone === "ok") return <CheckCircle2 className="h-6 w-6 shrink-0 text-primary" />;
  if (tone === "wait") return <Clock className="h-6 w-6 shrink-0 text-amber-600" />;
  return <XCircle className="h-6 w-6 shrink-0 text-destructive" />;
}

function formatAmount(cents: number | null, currency: string): string | null {
  if (cents === null) return null;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
  }).format(cents / 100);
}

export function PilotConfirmation() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const { sessionId, canceled } = readCheckoutParams();

    if (canceled) {
      cleanUrl();
      track("checkout_canceled");
      setPhase({ kind: "canceled" });
      return;
    }
    if (!sessionId) return;

    const controller = new AbortController();
    setPhase({ kind: "loading" });

    getPilotOrder(sessionId, { signal: controller.signal })
      .then((order) => {
        setPhase({ kind: "ready", order });
        // The terminal funnel event, fired from the confirmed server state
        // rather than from the redirect — a redirect is not a payment.
        track("checkout_succeeded", {
          offer: order.offerCode ?? "unknown",
          status: order.status,
        });
        cleanUrl();
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        // The customer's money may already be gone. Never render a bare
        // failure — always surface the reference they can quote.
        setPhase({
          kind: "error",
          message:
            err instanceof PilotApiError
              ? err.message
              : "Der Bestellstatus konnte nicht geladen werden.",
          reference: sessionId,
        });
        cleanUrl();
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (phase.kind === "ready" || phase.kind === "error") {
      document
        .getElementById("pilot-confirmation")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [phase.kind]);

  if (phase.kind === "idle") return null;

  return (
    <div id="pilot-confirmation" className="scroll-mt-28">
      {phase.kind === "loading" ? (
        <div className="flex items-center gap-3 rounded-[24px] border border-border/70 bg-card p-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Bestellstatus wird geprüft …</p>
        </div>
      ) : null}

      {phase.kind === "canceled" ? (
        <div className="rounded-[24px] border border-border/70 bg-card p-6">
          <p className="font-display text-base font-semibold text-foreground">
            Checkout abgebrochen — es wurde nichts abgebucht.
          </p>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            Ihre Angaben sind unten weiterhin vorhanden. Sie können den Vorgang jederzeit
            erneut starten.
          </p>
        </div>
      ) : null}

      {phase.kind === "error" ? (
        <div className="rounded-[24px] border border-amber-500/30 bg-amber-500/8 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
            <div className="space-y-2">
              <p className="font-display text-base font-semibold text-foreground">
                Zahlung möglicherweise erfolgreich — Status nicht abrufbar
              </p>
              <p className="text-sm leading-7 text-muted-foreground">
                {phase.message} Falls Ihre Zahlung durchgeführt wurde, ist der Auftrag
                dennoch bei uns registriert. Notieren Sie bitte diese Referenz:
              </p>
              {phase.reference ? (
                <code className="block break-all rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-xs">
                  {phase.reference}
                </code>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {phase.kind === "ready" ? <OrderPanel order={phase.order} copied={copied} setCopied={setCopied} /> : null}
    </div>
  );
}

function OrderPanel({
  order,
  copied,
  setCopied,
}: {
  order: PilotOrder;
  copied: boolean;
  setCopied: (v: boolean) => void;
}) {
  const copy = STATUS_COPY[order.status];
  const amount = formatAmount(order.amountTotalCents, order.currency);
  const settled = order.status === "paid" || order.status === "processing";

  return (
    <div className={`rounded-[28px] border p-6 sm:p-8 ${TONE_CLASS[copy.tone]}`}>
      <div className="flex items-start gap-4">
        <StatusIcon tone={copy.tone} />
        <div className="min-w-0 flex-1 space-y-6">
          <div className="space-y-2">
            <h3 className="font-display text-xl font-semibold leading-snug tracking-[-0.02em] text-foreground">
              {copy.title}
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">{copy.body}</p>
          </div>

          {/* ── Facts. Every value comes from Stripe, none is inferred. ── */}
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Fact label="Referenz">
              <span className="inline-flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">
                  {order.reference}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(order.reference).then(
                      () => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2000);
                      },
                      () => undefined,
                    );
                  }}
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label="Referenz kopieren"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copied ? (
                  <span className="text-[0.7rem] text-primary">kopiert</span>
                ) : null}
              </span>
            </Fact>
            <Fact label="Paket">{order.offerLabel}</Fact>
            {amount ? <Fact label="Betrag">{amount}</Fact> : null}
            {order.email ? <Fact label="Bestätigung an">{order.email}</Fact> : null}
            {order.location ? <Fact label="Standort">{order.location}</Fact> : null}
            {order.responseWindow ? (
              <Fact label="Bearbeitung">{order.responseWindow}</Fact>
            ) : null}
          </dl>

          {settled && order.deliverable ? (
            <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Sie erhalten
              </p>
              <p className="mt-2 text-sm leading-7 text-foreground/90">{order.deliverable}</p>
            </div>
          ) : null}

          {/* ── The next step is the customer's, and it is specific. ── */}
          {settled && order.requiredData.length > 0 ? (
            <div className="rounded-[20px] border border-border/60 bg-background/70 p-5">
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Damit wir beginnen können, senden Sie uns bitte
              </p>
              <ul className="mt-3 space-y-2">
                {order.requiredData.map((item: string) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-7 text-foreground/90">
                    <span
                      aria-hidden
                      className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                Antworten Sie dafür einfach auf die Bestätigungs-E-Mail und nennen Sie die
                Referenz <span className="font-mono text-foreground">{order.reference}</span>.
                Unterlagen können Sie direkt anhängen.
              </p>
            </div>
          ) : null}

          {!settled ? (
            <Button asChild size="lg" className="rounded-full">
              <a href="#pilot-checkout-form">Pilotaufnahme erneut starten</a>
            </Button>
          ) : null}

          <p className="text-[0.72rem] leading-6 text-muted-foreground">
            Der Leistungsumfang ergibt sich aus § 2 der AGB. Diese Bestätigung
            dokumentiert den Zahlungsstatus und ersetzt keine Rechts-, Steuer- oder
            Anlageberatung.
          </p>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground/90">{children}</dd>
    </div>
  );
}

export default PilotConfirmation;
