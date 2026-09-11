/**
 * server/index.ts — Energie Teilen Express server.
 *
 * Endpoints:
 *   POST /api/pilot-checkout    → creates Stripe Checkout session
 *   POST /api/lead              → captures Rechner / free-tool leads
 *   GET  /api/pilot-order/:id   → post-payment order confirmation (safe projection)
 *   GET  /api/v1/meta           → model, rates, validity windows (Bearer API key)
 *   POST /api/v1/calculate      → deterministic economics + provenance
 *   POST /api/v1/eligibility    → qualification verdict + next paid step
 *   GET  /api/admin/orders      → order ledger worklist (Bearer ADMIN_API_TOKEN)
 *   POST /api/admin/orders/:ref/stage → advance a ledger stage (Bearer)
 *   POST /api/stripe/webhook    → verified Stripe webhook (raw body, idempotent)
 *                                 sends operator notification AND customer confirmation
 *   GET  /api/health            → go-live scoreboard: presence, cost, fix (no secrets)
 *   GET  /*                     → serves the SPA (Vite build)
 *
 * Durability:
 *   Rate limiting and webhook idempotency use Upstash Redis IF configured
 *   (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). Without it, the
 *   server still runs: rate limiting falls back to per-instance memory and
 *   idempotency is best-effort. Paid orders and leads are additionally
 *   written to the KV (when present) so there is a durable record beyond email.
 *
 * Required env: see .env.example.
 */

import express from "express";
import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  Express,
} from "express";
import { createServer } from "http";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import {
  CreatePilotCheckoutInputSchema,
  LeadCaptureInputSchema,
  PILOT_OFFER_SERVER_CONFIG,
  type ApiError,
  type ApiErrorCode,
  type CreatePilotCheckoutResult,
  type LeadCaptureResult,
  type PilotOrder,
} from "../shared/schema.js";
import { toPilotOrder } from "../shared/pilot-order.js";
import { LEGAL_ENTITY } from "../shared/legal-entity.js";
import { buildHealthReport } from "../shared/health.js";
import { securityHeadersMiddleware } from "./security-headers.js";
import {
  advanceStage,
  nextAction,
  offerCodeOrNull,
  sortForWorklist,
  summarise,
  LedgerStageSchema,
  STAGE_LABEL_DE,
  type LedgerStage,
  type OrderLedgerRecord,
} from "../shared/ledger.js";
import { getKv } from "./kv.js";
import { dispatchApiV1, mountApiV1 } from "./api-v1.js";
import { mountMcp } from "./mcp.js";
import { apiKeysConfigured, configuredKeyLabels } from "./api-keys.js";
import {
  Deadline,
  STEP_TIMEOUT_MS,
  isSignatureVerificationError,
  withDeadlineOr,
} from "../shared/deadline.js";
import {
  getOrder,
  ledgerAvailable,
  listOrders,
  putOrder,
} from "./ledger-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// HELPERS
// ============================================================================

function apiError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  const body: ApiError = { ok: false, error: code, code, message, details };
  return res.status(status).json(body);
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  return (
    (typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : undefined) ||
    req.socket.remoteAddress ||
    "anon"
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Durable KV lives in server/kv.ts so the ledger can use it without importing
// the Express app.

/**
 * Rate limiter. Distributed fixed-window via Upstash when available
 * (correct on serverless), else per-instance memory fallback.
 */
function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  bucket: string;
}): RequestHandler {
  const mem = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const ip = getClientIp(req);
      const now = Date.now();
      const kv = await getKv();

      if (kv) {
        try {
          const windowId = Math.floor(now / opts.windowMs);
          const key = `rl:${opts.bucket}:${ip}:${windowId}`;
          const count: number = await kv.incr(key);
          if (count === 1) await kv.pexpire(key, opts.windowMs);
          if (count > opts.max) {
            apiError(res, 429, "rate_limited", "Zu viele Anfragen. Bitte später erneut versuchen.");
            return;
          }
          next();
          return;
        } catch (err) {
          console.warn("[rl] KV error — falling back to in-memory limiter", err);
        }
      }

      let entry = mem.get(ip);
      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + opts.windowMs };
        mem.set(ip, entry);
      }
      entry.count++;
      if (entry.count > opts.max) {
        apiError(res, 429, "rate_limited", "Zu viele Anfragen. Bitte später erneut versuchen.");
        return;
      }
      next();
    })();
  };
}

/** Lazy Stripe init; server starts cleanly even before `pnpm add stripe`. */
async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const StripeModule = await import("stripe");
    return new StripeModule.default(key);
  } catch (err) {
    console.error("[stripe] SDK not installed. Run: pnpm add stripe", err);
    return null;
  }
}

/**
 * Lazy Resend init; no-ops if unconfigured.
 *
 * Generalised so the same transport serves BOTH directions: the operator
 * notification (inbound lead / payment) and the customer confirmation
 * (outbound fulfillment). Previously it could only ever mail the operator,
 * which is why a paying customer received nothing from Energie Teilen.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL || "Energie Teilen <noreply@energie-teilen.de>";
  if (!apiKey || !to) {
    console.info("[resend] not configured — skipping mail:", subject);
    return false;
  }
  try {
    const ResendModule = await import("resend");
    const resend = new ResendModule.Resend(apiKey);
    await resend.emails.send({ from, to, subject, html });
    return true;
  } catch (err) {
    console.error("[resend] send failed", err);
    return false;
  }
}

/** Operator-facing notification. Unchanged behaviour, now a wrapper. */
async function sendNotificationEmail(subject: string, html: string): Promise<void> {
  const to = process.env.LEAD_NOTIFICATION_EMAIL;
  if (!to) {
    console.info("[resend] LEAD_NOTIFICATION_EMAIL unset — skipping:", subject);
    return;
  }
  await sendEmail(to, subject, html);
}

// ----------------------------------------------------------------------------
// Customer-facing confirmation
// ----------------------------------------------------------------------------

const eurFmt = (cents: number | null, currency: string): string =>
  cents === null ? "—" : `${(cents / 100).toFixed(2).replace(".", ",")} ${currency}`;

/**
 * The email a paying customer receives. States what was bought, the order
 * reference, what will be produced, and exactly which project data must be
 * sent back for work to start.
 *
 * It contains no turnaround promise: the AGB declares none, so the product
 * must not imply one. ET_PILOT_RESPONSE_WINDOW, if the operator sets it, is
 * echoed verbatim and is the only place such a statement can originate.
 */
function buildCustomerConfirmationHtml(order: PilotOrder, replyTo: string): string {
  const checklist = order.requiredData
    .map((item) => `<li style="margin:0 0 6px 0">${escapeHtml(item)}</li>`)
    .join("");

  const windowLine = order.responseWindow
    ? `<p style="margin:0 0 16px 0"><strong>Bearbeitung:</strong> ${escapeHtml(order.responseWindow)}</p>`
    : "";

  return `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6;max-width:640px">
    <div style="background:#1d493a;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:17px;font-weight:bold">Energie Teilen</div>
      <div style="font-size:12px;color:#cfe0d8;margin-top:4px">Bestätigung Ihrer Pilotaufnahme</div>
    </div>
    <div style="border:1px solid #e2e2dc;border-top:none;padding:24px;border-radius:0 0 8px 8px">
      <p style="margin:0 0 16px 0">Guten Tag${order.email ? "" : ""},</p>
      <p style="margin:0 0 16px 0">
        vielen Dank. Ihre Zahlung ist eingegangen und Ihre Pilotaufnahme ist unter der
        folgenden Referenz angelegt.
      </p>

      <table style="width:100%;border-collapse:collapse;margin:0 0 20px 0;font-size:14px">
        <tr><td style="padding:6px 0;color:#6b6b6b">Referenz</td><td style="padding:6px 0"><strong>${escapeHtml(order.reference)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b6b6b">Paket</td><td style="padding:6px 0">${escapeHtml(order.offerLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b6b6b">Betrag</td><td style="padding:6px 0">${escapeHtml(eurFmt(order.amountTotalCents, order.currency))}</td></tr>
        ${order.location ? `<tr><td style="padding:6px 0;color:#6b6b6b">Standort</td><td style="padding:6px 0">${escapeHtml(order.location)}</td></tr>` : ""}
      </table>

      ${order.deliverable ? `<p style="margin:0 0 8px 0"><strong>Sie erhalten:</strong></p><p style="margin:0 0 20px 0">${escapeHtml(order.deliverable)}</p>` : ""}
      ${windowLine}

      <p style="margin:0 0 8px 0"><strong>Damit wir beginnen können, senden Sie uns bitte:</strong></p>
      <ul style="margin:0 0 20px 0;padding-left:20px">${checklist}</ul>

      <p style="margin:0 0 16px 0">
        Antworten Sie einfach auf diese E-Mail oder schreiben Sie an
        <a href="mailto:${escapeHtml(replyTo)}" style="color:#1d493a">${escapeHtml(replyTo)}</a>
        und nennen Sie dabei die Referenz ${escapeHtml(order.reference)}.
        Unterlagen können Sie direkt anhängen.
      </p>

      <p style="margin:0;font-size:12px;color:#6b6b6b;border-top:1px solid #e2e2dc;padding-top:14px">
        Energie Teilen · Diese Bestätigung dokumentiert den Zahlungseingang.
        Der Leistungsumfang ergibt sich aus § 2 der AGB. Keine Rechts-, Steuer-
        oder Anlageberatung.
      </p>
    </div>
  </div>`;
}

/** Best-effort durable record. No-ops without KV. Never throws into the request. */
async function persistRecord(kind: string, id: string, data: unknown): Promise<void> {
  try {
    const kv = await getKv();
    if (!kv) return;
    await kv.set(`${kind}:${id}`, JSON.stringify({ id, at: new Date().toISOString(), data }));
    await kv.lpush(`${kind}:index`, id);
  } catch (err) {
    console.warn(`[persist] failed for ${kind}:${id}`, err);
  }
}

// ----------------------------------------------------------------------------
// ADMIN AUTH
// ----------------------------------------------------------------------------

/**
 * Constant-time bearer check against ADMIN_API_TOKEN.
 *
 * A plain `===` on a secret leaks its prefix through timing. Cheap to do
 * right, so it is done right. Absent or short token = admin surface disabled
 * entirely rather than open.
 */
function isAuthorisedAdmin(req: Request): boolean {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected || expected.length < 16) return false;

  const header = req.headers.authorization;
  const presented =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice(7)
      : "";
  if (presented.length === 0) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so length is not a fast-path oracle.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Short, non-reversible tag for the audit trail — never the token itself. */
function adminActorTag(): string {
  const token = process.env.ADMIN_API_TOKEN || "";
  return `admin:${createHash("sha256").update(token).digest("hex").slice(0, 8)}`;
}

// ============================================================================
// APP BUILDER
// ============================================================================

export async function buildApp(): Promise<Express> {
  const app = express();
  app.disable("x-powered-by");
  // Applied before anything can respond, so no route can answer without them.
  app.use(securityHeadersMiddleware());

  // Stripe webhook MUST receive the raw body BEFORE express.json runs.
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const stripe = await getStripe();
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!stripe || !webhookSecret) {
        /*
         * Answering 200 here would be a fake success: an unauthenticated
         * caller would receive a confirmation that their event was accepted,
         * and a genuine Stripe delivery would be silently discarded instead of
         * being retried. 503 says the endpoint exists but cannot verify
         * anything yet, which is both true and the status Stripe retries on.
         */
        console.warn("[stripe] webhook received but stripe is not configured");
        return res.status(503).send("stripe not configured");
      }

      const signature = req.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return res.status(400).send("missing signature");
      }

      // Hoisted so the catch block can release the claim it may have taken.
      let eventId: string | undefined;

      try {
        const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
        eventId = event.id;

        // Idempotency as a claim, not a tombstone.
        //
        // Claim for 5 minutes — long enough that concurrent deliveries of the
        // same event cannot both run — extend to 7 days once the work succeeds,
        // and release the claim on failure so Stripe's retry can redo it.
        const kv = await getKv();
        const claimKey = `stripe:evt:${event.id}`;
        const CLAIM_TTL_S = 300;
        const DONE_TTL_S = 60 * 60 * 24 * 7;

        if (kv) {
          const claimed = await kv.set(claimKey, "claimed", { nx: true, ex: CLAIM_TTL_S });
          if (claimed === null) {
            // Already claimed or already done: acknowledge, run nothing.
            return res.status(200).send("ok");
          }
        }

        const completeClaim = async () => {
          if (!kv) return;
          try {
            await kv.set(claimKey, "done", { ex: DONE_TTL_S });
          } catch (err) {
            console.error(`[stripe] could not finalise claim ${claimKey}`, err);
          }
        };

        // Bound the work so the platform never kills us mid-flight. See
        // shared/deadline.ts for why "respond first, work after" is wrong here.
        const deadline = new Deadline();

        if (
          event.type === "checkout.session.completed" ||
          event.type === "checkout.session.async_payment_succeeded"
        ) {
          // `as` narrows to the subset we read. toPilotOrder() is structural,
          // so the shared mapper never imports the Stripe SDK.
          const session = event.data.object as {
            id: string;
            status?: string | null;
            payment_status?: string | null;
            amount_total: number | null;
            currency: string | null;
            customer_email: string | null;
            customer_details?: { email?: string | null } | null;
            created?: number | null;
            metadata?: Record<string, string>;
          };
          const md = session.metadata ?? {};
          const order = toPilotOrder(session, {
            responseWindow: process.env.ET_PILOT_RESPONSE_WINDOW ?? null,
          });

          // ── LEDGER: the order becomes an enumerable record, not just an email.
          const nowIso = new Date().toISOString();
          const existing = await getOrder(order.reference);
          const ledgerRecord: OrderLedgerRecord = existing ?? {
            kind: "order",
            reference: order.reference,
            sessionId: session.id,
            stage: "intake",
            offerCode: offerCodeOrNull(md.offerCode),
            offerLabel: order.offerLabel,
            amountTotalCents: order.amountTotalCents,
            currency: order.currency,
            email: order.email,
            name: md.name || null,
            organization: order.organization,
            location: order.location,
            projectType: order.projectType,
            owner: null,
            source: "stripe:checkout",
            eligibilityVerdict: md.eligibilityVerdict || null,
            createdAt: order.createdAt ?? nowIso,
            updatedAt: nowIso,
            durable: false,
            history: [{ at: nowIso, stage: "intake", by: "stripe:webhook" }],
          };

          let current = ledgerRecord;
          if (order.status === "paid" && current.stage === "intake") {
            const moved = advanceStage(current, "paid", "stripe:webhook", { now: new Date() });
            if (moved.ok) current = moved.record;
          }
          const written = await putOrder(current);
          current = written.record;

          // ── Operator notification (unchanged content, now reference-stamped)
          const html = `
            <h2>✅ Neue bezahlte Pilotaufnahme</h2>
            ${
              written.durable
                ? ""
                : `<p style="background:#fdf7ec;border:1px solid #c79236;padding:10px">
                     <strong>⚠️ Nicht dauerhaft gespeichert.</strong> Dieser Auftrag existiert nur
                     in Stripe und in dieser E-Mail. Setzen Sie UPSTASH_REDIS_REST_URL und
                     UPSTASH_REDIS_REST_TOKEN, damit Aufträge im Ledger auffindbar bleiben.
                   </p>`
            }
            <p><strong>Referenz:</strong> ${escapeHtml(order.reference)}</p>
            <p><strong>Status:</strong> ${escapeHtml(order.status)}</p>
            <p><strong>Paket:</strong> ${escapeHtml(md.offerLabel || md.offerCode || "—")}</p>
            <p><strong>Betrag:</strong> ${
              session.amount_total
                ? `${(session.amount_total / 100).toFixed(2)} ${(session.currency || "EUR").toUpperCase()}`
                : "—"
            }</p>
            <hr/>
            <p><strong>Ansprechpartner:</strong> ${escapeHtml(md.name || "—")}</p>
            <p><strong>E-Mail:</strong> ${escapeHtml(order.email || "—")}</p>
            <p><strong>Organisation:</strong> ${escapeHtml(md.organization || "—")}</p>
            <p><strong>Telefon:</strong> ${escapeHtml(md.phone || "—")}</p>
            <p><strong>Standort:</strong> ${escapeHtml(md.location || "—")}</p>
            <p><strong>Projekttyp:</strong> ${escapeHtml(md.projectType || "—")}</p>
            <hr/>
            <p><small>Stripe Session ID: ${escapeHtml(session.id)}</small></p>
          `;
          // The two mails are independent. Sending them sequentially spent two
          // full round-trips of the budget for no reason.
          //
          // Per-session guard (not per-event) so `completed` followed by
          // `async_payment_succeeded` on a SEPA debit cannot mail twice.
          let alreadySent = false;
          const shouldConfirm = order.status === "paid" && Boolean(order.email);
          if (shouldConfirm && kv) {
            const fresh = await withDeadlineOr(
              kv.set(`order:confirmed:${session.id}`, "1", { nx: true, ex: 60 * 60 * 24 * 30 }),
              STEP_TIMEOUT_MS,
              "confirm-guard",
              null,
            );
            alreadySent = fresh === null;
          }

          // Last resort is the operator record's own mailbox — the same
          // address the imprint and the PDF name — never a second literal.
          const replyTo =
            process.env.ET_CUSTOMER_REPLY_TO ||
            process.env.LEAD_NOTIFICATION_EMAIL ||
            LEGAL_ENTITY.email;

          const [, customerSent] = await Promise.all([
            // Operator notification is nice-to-have: a slow inbox must never
            // cost a customer their confirmation.
            withDeadlineOr(
              sendNotificationEmail(
                `[Energie Teilen] 💰 Bezahlt: ${order.reference} · ${md.offerLabel || md.offerCode}`,
                html,
              ),
              STEP_TIMEOUT_MS,
              "operator-mail",
              undefined,
            ),
            shouldConfirm && !alreadySent
              ? withDeadlineOr(
                  sendEmail(
                    order.email as string,
                    `Energie Teilen · Bestätigung ${order.reference} — ${order.offerLabel}`,
                    buildCustomerConfirmationHtml(order, replyTo),
                  ),
                  STEP_TIMEOUT_MS,
                  "customer-mail",
                  false,
                )
              : Promise.resolve(alreadySent),
          ]);

          if (shouldConfirm) {
            {
              const sent = customerSent;
              if (!sent) {
                // The customer paid and we could not confirm. That is an
                // operational incident, not a log line to lose.
                console.error(
                  `[fulfillment] confirmation NOT delivered for ${order.reference} (${order.email})`,
                );
                await sendNotificationEmail(
                  `[Energie Teilen] ⚠️ Bestätigung NICHT zugestellt: ${order.reference}`,
                  `<p>Zahlung eingegangen, aber die Kundenbestätigung konnte nicht versendet werden.</p>
                   <p><strong>Referenz:</strong> ${escapeHtml(order.reference)}</p>
                   <p><strong>E-Mail:</strong> ${escapeHtml(order.email ?? "—")}</p>
                   <p>Bitte manuell bestätigen.</p>`,
                );
              } else if (!alreadySent) {
                // Confirmation delivered: the ball is now in the customer's
                // court, and the ledger says so without anyone updating it.
                // If we never get here the order stays at "paid", whose derived
                // next action already reads "Bestaetigung versenden". A timeout
                // becomes visible work rather than a silent gap.
                const moved = advanceStage(current, "awaiting_data", "stripe:webhook", {
                  note: "Bestätigung und Datenanforderung versendet",
                });
                if (moved.ok) await putOrder(moved.record);
              }
            }
          }

          if (deadline.expired()) {
            console.warn(
              `[stripe] fulfillment for ${order.reference} used the full budget (${deadline.elapsed()}ms)`,
            );
          }
        }

        await completeClaim();
        return res.status(200).send("ok");
      } catch (err) {
        // Signature failures are the caller's problem: 400, and no claim was
        // taken because we never got past constructEvent.
        if (isSignatureVerificationError(err)) {
          console.error("[stripe] webhook signature verification failed", err);
          return res.status(400).send("invalid signature");
        }

        // Anything else means the work did NOT complete. Release the claim so
        // Stripe's retry runs it again, and return 500 so Stripe knows to retry
        // rather than recording a success we did not achieve.
        console.error("[stripe] webhook processing failed", err);
        try {
          const kvForRelease = await getKv();
          if (kvForRelease) await kvForRelease.del(`stripe:evt:${eventId ?? "unknown"}`);
        } catch (releaseErr) {
          console.error("[stripe] claim release failed", releaseErr);
        }
        return res.status(500).send("processing failed");
      }
    },
  );

  app.use(express.json({ limit: "100kb" }));

  // POST /api/pilot-checkout
  const pilotCheckoutLimiter = createRateLimiter({ windowMs: 60_000, max: 10, bucket: "checkout" });

  app.post("/api/pilot-checkout", pilotCheckoutLimiter, async (req: Request, res: Response) => {
    const parsed = CreatePilotCheckoutInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "validation_error", "Die Eingaben sind unvollständig oder ungültig.", parsed.error.issues);
    }
    const input = parsed.data;

    if (input.website && input.website.length > 0) {
      return apiError(res, 400, "spam_detected", "Anfrage konnte nicht verarbeitet werden.");
    }

    const offerConfig = PILOT_OFFER_SERVER_CONFIG[input.offerCode];
    const priceId = process.env[offerConfig.stripePriceEnvVar];

    const stripe = await getStripe();
    if (!stripe) {
      return apiError(res, 503, "config_missing", "Checkout ist aktuell nicht konfiguriert. Bitte versuchen Sie es später erneut.");
    }
    if (!priceId) {
      console.error(`[checkout] missing price env var: ${offerConfig.stripePriceEnvVar}`);
      return apiError(res, 503, "config_missing", `Preisinformation für ${offerConfig.label} fehlt serverseitig.`);
    }

    const appUrl = process.env.APP_URL || "http://localhost:3000";

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: input.email,
        success_url: `${appUrl}/?paid=1&session_id={CHECKOUT_SESSION_ID}#pilot-start`,
        cancel_url: `${appUrl}/?canceled=1#pilot-start`,
        payment_method_types: ["card", "sepa_debit"],
        billing_address_collection: "required",
        locale: "de",
        metadata: {
          offerCode: input.offerCode,
          offerLabel: offerConfig.label,
          projectType: input.projectType,
          name: input.name,
          email: input.email,
          organization: input.organization || "",
          location: input.location,
          phone: input.phone || "",
          privacyPolicyAccepted: String(input.legalAcceptances.privacyPolicyAccepted),
          pilotTermsAccepted: String(input.legalAcceptances.pilotTermsAccepted),
          marketingConsent: String(input.legalAcceptances.marketingConsent ?? false),
          eligibilityVerdict: input.eligibilityVerdict ?? "",
        },
      });

      if (!session.url) {
        return apiError(res, 500, "stripe_error", "Checkout-URL konnte nicht erstellt werden.");
      }

      const result: CreatePilotCheckoutResult = {
        ok: true,
        checkoutUrl: session.url,
        sessionId: session.id,
        offerCode: input.offerCode,
        offerLabel: offerConfig.label,
        projectType: input.projectType,
        currency: offerConfig.currency,
        stage: "checkout_created",
      };
      return res.status(200).json(result);
    } catch (err) {
      console.error("[stripe] checkout creation failed", err);
      return apiError(res, 500, "stripe_error", "Checkout konnte nicht erstellt werden. Bitte später erneut versuchen.");
    }
  });

  // POST /api/lead
  const leadLimiter = createRateLimiter({ windowMs: 60_000, max: 20, bucket: "lead" });

  app.post("/api/lead", leadLimiter, async (req: Request, res: Response) => {
    const parsed = LeadCaptureInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "validation_error", "Die Eingaben sind unvollständig oder ungültig.", parsed.error.issues);
    }
    const input = parsed.data;

    if (input.website && input.website.length > 0) {
      return apiError(res, 400, "spam_detected", "Anfrage konnte nicht verarbeitet werden.");
    }

    const leadId = randomUUID();

    await persistRecord("lead", leadId, {
      email: input.email,
      source: input.source,
      consent: input.consent,
      payload: input.payload ?? null,
    });

    const payloadStr = input.payload
      ? `<pre>${escapeHtml(JSON.stringify(input.payload, null, 2))}</pre>`
      : "<p><em>kein Payload</em></p>";

    await sendNotificationEmail(
      `[Energie Teilen] 📥 Neuer Lead: ${input.source}`,
      `<h2>Neuer Lead</h2>
       <p><strong>Quelle:</strong> ${escapeHtml(input.source)}</p>
       <p><strong>E-Mail:</strong> ${escapeHtml(input.email)}</p>
       <p><strong>Lead-ID:</strong> ${escapeHtml(leadId)}</p>
       <hr/>
       ${payloadStr}`,
    );

    const result: LeadCaptureResult = { ok: true, leadId };
    return res.status(200).json(result);
  });

  // GET /api/pilot-order/:sessionId
  // ---------------------------------------------------------------------------
  // Closes the funnel. Stripe's success_url returns the buyer to
  // /?paid=1&session_id=cs_..., and until now nothing could resolve that id
  // into a confirmation. Returns only the safe projection from
  // shared/pilot-order.ts — never the raw Stripe session.
  //
  // The session id is an unguessable Stripe secret-ish token, so possession of
  // it is the authorisation. It is still rate-limited, format-checked and
  // never enumerable.
  // ---------------------------------------------------------------------------
  const orderLookupLimiter = createRateLimiter({ windowMs: 60_000, max: 30, bucket: "order" });

  app.get("/api/pilot-order/:sessionId", orderLookupLimiter, async (req: Request, res: Response) => {
    const sessionId = String(req.params.sessionId || "");

    // Stripe Checkout Session ids: cs_test_... / cs_live_...
    if (!/^cs_[A-Za-z0-9_]{10,255}$/.test(sessionId)) {
      return apiError(res, 400, "validation_error", "Ungültige Bestellreferenz.");
    }

    const stripe = await getStripe();
    if (!stripe) {
      return apiError(res, 503, "config_missing", "Bestellstatus ist aktuell nicht abrufbar.");
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const order: PilotOrder = toPilotOrder(session, {
        responseWindow: process.env.ET_PILOT_RESPONSE_WINDOW ?? null,
      });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(order);
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404) {
        return apiError(res, 404, "not_found", "Zu dieser Referenz wurde keine Bestellung gefunden.");
      }
      console.error("[stripe] order lookup failed", err);
      return apiError(res, 500, "stripe_error", "Bestellstatus konnte nicht geladen werden.");
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN — the order ledger
  //
  // Makes paid work enumerable: what is open, what is overdue, what it is
  // worth, and what to do next. JSON only; no console UI.
  //
  // Disabled entirely unless ADMIN_API_TOKEN is set to >= 16 chars.
  // ---------------------------------------------------------------------------
  const adminLimiter = createRateLimiter({ windowMs: 60_000, max: 60, bucket: "admin" });

  const requireAdmin: RequestHandler = (req, res, next) => {
    if (!isAuthorisedAdmin(req)) {
      // Same response whether the token is wrong or unset: no probing.
      apiError(res, 401, "not_found", "Nicht autorisiert.");
      return;
    }
    next();
  };

  app.get("/api/admin/orders", adminLimiter, requireAdmin, async (req: Request, res: Response) => {
    if (!ledgerAvailable()) {
      return apiError(
        res,
        503,
        "config_missing",
        "Kein dauerhafter Speicher konfiguriert — Aufträge können nicht aufgelistet werden. UPSTASH_REDIS_REST_URL und UPSTASH_REDIS_REST_TOKEN setzen.",
      );
    }

    const limit = Number.parseInt(String(req.query.limit ?? "100"), 10);
    const stageFilter = LedgerStageSchema.safeParse(req.query.stage);
    const now = new Date();

    let records = await listOrders(Number.isFinite(limit) ? limit : 100);
    if (stageFilter.success) records = records.filter((r) => r.stage === stageFilter.data);

    const worklist = sortForWorklist(records, now).map((r) => {
      const na = nextAction(r, now);
      return {
        reference: r.reference,
        stage: r.stage,
        stageLabel: STAGE_LABEL_DE[r.stage],
        offerLabel: r.offerLabel,
        valueCents: r.amountTotalCents,
        currency: r.currency,
        email: r.email,
        organization: r.organization,
        location: r.location,
        owner: r.owner,
        source: r.source,
        eligibilityVerdict: r.eligibilityVerdict,
        nextAction: na.action,
        overdue: na.overdue,
        ageDays: na.ageDays,
        durable: r.durable,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      summary: summarise(records, now),
      orders: worklist,
    });
  });

  app.post(
    "/api/admin/orders/:reference/stage",
    adminLimiter,
    requireAdmin,
    async (req: Request, res: Response) => {
      const reference = String(req.params.reference || "");
      if (!/^ET-[0-9A-Z]{8}$/.test(reference)) {
        return apiError(res, 400, "validation_error", "Ungültige Referenz.");
      }

      const parsedStage = LedgerStageSchema.safeParse(req.body?.stage);
      if (!parsedStage.success) {
        return apiError(res, 400, "validation_error", "Unbekannte Stufe.", parsedStage.error.issues);
      }

      const record = await getOrder(reference);
      if (!record) {
        return apiError(res, 404, "not_found", "Auftrag nicht gefunden.");
      }

      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : undefined;
      const moved = advanceStage(record, parsedStage.data as LedgerStage, adminActorTag(), { note });
      if (!moved.ok) {
        // A rejected transition is information, not a failure: say what IS allowed.
        return apiError(
          res,
          409,
          "validation_error",
          `Übergang von "${record.stage}" nach "${parsedStage.data}" ist nicht zulässig.`,
          { allowed: moved.allowed },
        );
      }

      const owner = typeof req.body?.owner === "string" ? req.body.owner.slice(0, 120) : undefined;
      const finalRecord = owner === undefined ? moved.record : { ...moved.record, owner };
      const written = await putOrder(finalRecord);
      if (!written.durable) {
        return apiError(res, 503, "config_missing", "Änderung konnte nicht dauerhaft gespeichert werden.");
      }

      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        ok: true,
        reference,
        stage: written.record.stage,
        stageLabel: STAGE_LABEL_DE[written.record.stage],
        nextAction: nextAction(written.record).action,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // PUBLIC COMPUTATION API — /api/v1
  //
  // The deterministic engine behind a key. Every response carries the model
  // stamp, per-input provenance and the validity window of each regulated rate.
  // Disabled entirely unless ET_API_KEYS is configured.
  // ---------------------------------------------------------------------------
  const apiV1Limiter = createRateLimiter({ windowMs: 60_000, max: 120, bucket: "apiv1" });
  mountApiV1(app, { limiter: apiV1Limiter });

  /*
   * The same engines as tools an agent can call.
   *
   * Ranking for a query gets the product mentioned; being callable gets it
   * used, inside whatever workflow the agent is already running. Each tool
   * dispatches to the v1 handler of the same name in-process, so there is one
   * implementation and one set of refusals.
   */
  mountMcp(app, { limiter: apiV1Limiter, invoke: async (endpoint, method, payload) => dispatchApiV1(endpoint, method, payload) });

  // GET /api/health
  /*
   * Health.
   *
   * The go-live scoreboard. A monitor has to be able to tell "running" from
   * "able to take money". Reporting ok on a deployment that cannot take a
   * payment would be a fake success in the one place that exists to detect
   * failure, so the verdict is DERIVED from the capability register in
   * shared/health.ts — the same register `pnpm doctor` renders — and the body
   * says which capability decided it, what its absence costs and how to fix it.
   *
   *   ok       — every revenue blocker and every fulfilment capability present
   *   degraded — money can move; delivery or record-keeping cannot fully
   *   blocked  — at least one revenue blocker is missing: no euro can move
   *
   * Presence and usability only, never a value. The HTTP status stays 200 for
   * all three, so an uptime probe still sees the process as alive; the body
   * carries the verdict.
   */
  app.get("/api/health", async (_req: Request, res: Response) => {
    const report = buildHealthReport({
      env: process.env,
      legalEntity: LEGAL_ENTITY,
      apiKeysConfigured: apiKeysConfigured(),
      production: process.env.NODE_ENV === "production",
    });

    /*
     * Legacy flat view, kept byte-compatible for smoke-test.sh and existing
     * monitors. The scoreboard above is the authority; this is a projection.
     */
    const config = {
      stripe: Boolean(process.env.STRIPE_SECRET_KEY),
      stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      resend: Boolean(process.env.RESEND_API_KEY),
      durableKv: Boolean(
        process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
      ),
      prices: {
        et_eligibility: Boolean(process.env.STRIPE_PRICE_ET_ELIGIBILITY),
        et_structuring: Boolean(process.env.STRIPE_PRICE_ET_STRUCTURING),
        et_mandate: Boolean(process.env.STRIPE_PRICE_ET_MANDATE),
      },
      customerConfirmation: Boolean(
        process.env.RESEND_API_KEY &&
          (process.env.ET_CUSTOMER_REPLY_TO || process.env.LEAD_NOTIFICATION_EMAIL),
      ),
      responseWindow: process.env.ET_PILOT_RESPONSE_WINDOW || "(unset)",
      // The launch-blocking one: without this, paid orders are not enumerable.
      durableOrders: ledgerAvailable(),
      adminApi: Boolean(
        process.env.ADMIN_API_TOKEN && process.env.ADMIN_API_TOKEN.length >= 16,
      ),
      publicApi: apiKeysConfigured(),
      publicApiClients: configuredKeyLabels().length,
      appUrl: process.env.APP_URL || "(unset)",
      legalEntity: LEGAL_ENTITY.configured,
    };

    res.setHeader("Cache-Control", "no-store");
    res.json({ ...report, config });
  });

  app.all("/api/*", (_req: Request, res: Response) =>
    apiError(res, 404, "not_found", "Endpunkt nicht gefunden."),
  );

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  /*
   * redirect:false — without it express.static answers "/messkonzept" with a
   * 301 to "/messkonzept/", which is not the URL the page declares as
   * canonical. The route handler below serves the document at the path that is
   * canonical, so the two agree.
   */
  app.use(express.static(staticPath, { redirect: false }));

  /*
   * Asset paths must 404 rather than falling through to the SPA shell.
   *
   * A missing font, image or script previously answered 200 with index.html,
   * which the browser then tried to parse as that asset type — producing a
   * decode error instead of a missing-file error, and hiding broken paths
   * behind a page that looks fine. It also lets any URL ending in a known
   * extension be served as HTML.
   */
  const ASSET_EXTENSIONS =
    /\.(js|mjs|css|map|json|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|pdf|txt|xml|webmanifest|mp4|webm)$/i;

  /*
   * Per-route documents.
   *
   * The build emits one HTML file per route with that route's own title,
   * description, canonical URL and structured data. Serving the shared shell
   * for every path would hand a crawler, a link preview and a chat unfurl the
   * landing page's metadata for every page on the site — client-side updates
   * arrive too late for all three.
   *
   * The file is served at the path without a trailing slash, so the URL that
   * is canonical is also the URL that answers.
   */
  const routeDocument = (urlPath: string): string | null => {
    const clean = urlPath.replace(/\/+$/, "");
    if (clean === "" || clean === "/") return path.join(staticPath, "index.html");
    if (!/^\/[a-z0-9-]+$/i.test(clean)) return null;
    const candidate = path.join(staticPath, clean.slice(1), "index.html");
    return existsSync(candidate) ? candidate : null;
  };

  app.get("*", (req: Request, res: Response) => {
    if (ASSET_EXTENSIONS.test(req.path)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    res.sendFile(routeDocument(req.path) ?? path.join(staticPath, "index.html"));
  });

  return app;
}

// ============================================================================
// BOOT
// ============================================================================

async function startServer() {
  const app = await buildApp();
  const server = createServer(app);
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Energie Teilen server running on http://localhost:${port}/`);
    console.log(
      `Configured: stripe=${!!process.env.STRIPE_SECRET_KEY} resend=${!!process.env.RESEND_API_KEY} kv=${!!process.env.UPSTASH_REDIS_REST_URL}`,
    );
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  startServer().catch((err) => {
    console.error("[server] failed to start", err);
    process.exit(1);
  });
}

export default startServer;
