/**
 * server/index.ts — Energie Teilen Express server.
 *
 * Endpoints:
 *   POST /api/pilot-checkout    → creates Stripe Checkout session
 *   POST /api/lead              → captures Rechner / free-tool leads
 *   GET  /api/pilot-order/:id   → post-payment order confirmation (safe projection)
 *   POST /api/stripe/webhook    → verified Stripe webhook (raw body, idempotent)
 *                                 sends operator notification AND customer confirmation
 *   GET  /api/health            → config presence check (no secrets exposed)
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
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
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

// ----------------------------------------------------------------------------
// Optional durable KV (Upstash Redis). Lazily imported; degrades gracefully.
// ----------------------------------------------------------------------------
let kvPromise: Promise<any | null> | null = null;
async function getKv(): Promise<any | null> {
  if (!kvPromise) {
    kvPromise = (async () => {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) return null;
      try {
        const mod = await import("@upstash/redis");
        return new mod.Redis({ url, token });
      } catch (err) {
        console.warn(
          "[kv] UPSTASH env set but @upstash/redis not installed. Run: pnpm add @upstash/redis",
          err,
        );
        return null;
      }
    })();
  }
  return kvPromise;
}

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

// ============================================================================
// APP BUILDER
// ============================================================================

export async function buildApp(): Promise<Express> {
  const app = express();
  app.disable("x-powered-by");

  // Stripe webhook MUST receive the raw body BEFORE express.json runs.
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const stripe = await getStripe();
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!stripe || !webhookSecret) {
        console.warn("[stripe] webhook received but stripe is not configured");
        return res.status(200).send("ok");
      }

      const signature = req.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return res.status(400).send("missing signature");
      }

      try {
        const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);

        // Idempotency: process each Stripe event id at most once (when KV present).
        const kv = await getKv();
        if (kv) {
          const fresh = await kv.set(`stripe:evt:${event.id}`, "1", {
            nx: true,
            ex: 60 * 60 * 24 * 7,
          });
          if (fresh === null) {
            // Already handled — acknowledge without re-running side effects.
            return res.status(200).send("ok");
          }
        }

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

          await persistRecord("order", session.id, {
            reference: order.reference,
            status: order.status,
            amount_total: session.amount_total,
            currency: session.currency,
            email: order.email,
            offerCode: md.offerCode,
            offerLabel: order.offerLabel,
            metadata: md,
          });

          // ── Operator notification (unchanged content, now reference-stamped)
          const html = `
            <h2>✅ Neue bezahlte Pilotaufnahme</h2>
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
          await sendNotificationEmail(
            `[Energie Teilen] 💰 Bezahlt: ${order.reference} · ${md.offerLabel || md.offerCode}`,
            html,
          );

          // ── FULFILLMENT: confirm to the CUSTOMER.
          // Guarded per session (not per event) so `completed` followed by
          // `async_payment_succeeded` on a SEPA debit cannot mail twice.
          if (order.status === "paid" && order.email) {
            let alreadySent = false;
            const kvForMail = await getKv();
            if (kvForMail) {
              const fresh = await kvForMail.set(`order:confirmed:${session.id}`, "1", {
                nx: true,
                ex: 60 * 60 * 24 * 30,
              });
              alreadySent = fresh === null;
            }
            if (!alreadySent) {
              const replyTo =
                process.env.ET_CUSTOMER_REPLY_TO ||
                process.env.LEAD_NOTIFICATION_EMAIL ||
                "kontakt@energie-teilen.de";
              const sent = await sendEmail(
                order.email,
                `Energie Teilen · Bestätigung ${order.reference} — ${order.offerLabel}`,
                buildCustomerConfirmationHtml(order, replyTo),
              );
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
                   <p><strong>E-Mail:</strong> ${escapeHtml(order.email)}</p>
                   <p>Bitte manuell bestätigen.</p>`,
                );
              }
            }
          }
        }

        return res.status(200).send("ok");
      } catch (err) {
        console.error("[stripe] webhook verification failed", err);
        return res.status(400).send("invalid signature");
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

  // GET /api/health
  app.get("/api/health", async (_req: Request, res: Response) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      config: {
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
        stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        resend: Boolean(process.env.RESEND_API_KEY),
        durableKv: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
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
        appUrl: process.env.APP_URL || "(unset)",
      },
    });
  });

  app.all("/api/*", (_req: Request, res: Response) =>
    apiError(res, 404, "not_found", "Endpunkt nicht gefunden."),
  );

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
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
