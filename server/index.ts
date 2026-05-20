/**
 * server/index.ts
 *
 * Energie Teilen — Express server.
 *
 * Endpoints:
 *   POST /api/pilot-checkout    → creates Stripe Checkout session
 *   POST /api/lead              → captures Mieterstrom-Rechner / free-tool leads
 *   POST /api/stripe/webhook    → verified Stripe webhook (raw body)
 *   GET  /api/health            → config presence check (no secrets exposed)
 *   GET  /*                     → serves the SPA (Vite build)
 *
 * Validation: every body is parsed with a Zod schema from shared/schema.ts.
 * Rate limiting: in-memory by IP, sufficient for v1.
 * Persistence: lead notifications go to Resend (your inbox IS the database
 *              for v1); paid pilots are tracked by Stripe.
 *
 * Required environment variables (see .env.example):
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_ET_ELIGIBILITY
 *   STRIPE_PRICE_ET_STRUCTURING
 *   STRIPE_PRICE_ET_MANDATE
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL          e.g. "Energie Teilen <noreply@energie-teilen.de>"
 *   LEAD_NOTIFICATION_EMAIL    e.g. "vincenzo.grimaldi.engineering@gmail.com"
 *   APP_URL                    e.g. "https://energie-teilen-site.vercel.app"
 *
 * After adding deps:  pnpm add stripe resend
 *
 * Deploy note for Vercel:
 *   Plain `framework: vite` static deploys do NOT run this Express server.
 *   To make /api/* work on Vercel, either:
 *     (a) add a vercel.json that routes /api/(.*) to a Node serverless handler
 *         which wraps `await buildApp()` with `serverless-http`, OR
 *     (b) deploy the bundled server output (dist/index.js from your existing
 *         build script) to Railway / Fly.io / Render and point Vercel only at
 *         the static dist/public folder.
 *   For local development, `pnpm dev` already proxies /api/* to this process
 *   via the existing vite.config.ts dev-server proxy (if not present yet,
 *   add: server.proxy = { "/api": "http://localhost:3000" }).
 */

import express, { type Request, type Response, type NextFunction } from "express";
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
} from "../shared/schema.js";

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

/** In-memory rate limiter. Per-IP token bucket, resets each window. */
function createRateLimiter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const forwarded = req.headers["x-forwarded-for"];
    const ip =
      (typeof forwarded === "string"
        ? forwarded.split(",")[0]?.trim()
        : Array.isArray(forwarded)
          ? forwarded[0]
          : undefined) ||
      req.socket.remoteAddress ||
      "anon";

    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > opts.max) {
      return apiError(
        res,
        429,
        "rate_limited",
        "Zu viele Anfragen. Bitte später erneut versuchen.",
      );
    }
    next();
  };
}

/** Lazy import of stripe so the server starts cleanly even before `pnpm add stripe`. */
async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const StripeModule = await import("stripe");
    const Stripe = StripeModule.default;
    return new Stripe(key);
  } catch (err) {
    console.error("[stripe] SDK not installed. Run: pnpm add stripe", err);
    return null;
  }
}

/** Lazy import of resend. Gracefully no-ops if not configured. */
async function sendNotificationEmail(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFICATION_EMAIL;
  const from = process.env.RESEND_FROM_EMAIL || "Energie Teilen <noreply@energie-teilen.de>";
  if (!apiKey || !to) {
    console.info("[resend] not configured — skipping notification:", subject);
    return;
  }
  try {
    const ResendModule = await import("resend");
    const { Resend } = ResendModule;
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to, subject, html });
  } catch (err) {
    console.error("[resend] send failed", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================================
// APP BUILDER
// ============================================================================

export async function buildApp() {
  const app = express();
  app.disable("x-powered-by");

  // --------------------------------------------------------------------------
  // Stripe webhook MUST receive the raw body BEFORE express.json runs.
  // --------------------------------------------------------------------------
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
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
        const event = stripe.webhooks.constructEvent(
          req.body,
          signature,
          webhookSecret,
        );

        if (event.type === "checkout.session.completed") {
          const session = event.data.object as {
            id: string;
            amount_total: number | null;
            currency: string | null;
            customer_email: string | null;
            metadata?: Record<string, string>;
          };
          const md = session.metadata ?? {};
          const html = `
            <h2>✅ Neue bezahlte Pilotaufnahme</h2>
            <p><strong>Paket:</strong> ${escapeHtml(md.offerLabel || md.offerCode || "—")}</p>
            <p><strong>Betrag:</strong> ${
              session.amount_total
                ? `${(session.amount_total / 100).toFixed(2)} ${(session.currency || "EUR").toUpperCase()}`
                : "—"
            }</p>
            <hr/>
            <p><strong>Ansprechpartner:</strong> ${escapeHtml(md.name || "—")}</p>
            <p><strong>E-Mail:</strong> ${escapeHtml(md.email || session.customer_email || "—")}</p>
            <p><strong>Organisation:</strong> ${escapeHtml(md.organization || "—")}</p>
            <p><strong>Telefon:</strong> ${escapeHtml(md.phone || "—")}</p>
            <p><strong>Standort:</strong> ${escapeHtml(md.location || "—")}</p>
            <p><strong>Projekttyp:</strong> ${escapeHtml(md.projectType || "—")}</p>
            <hr/>
            <p><small>Stripe Session ID: ${escapeHtml(session.id)}</small></p>
          `;
          await sendNotificationEmail(
            `[Energie Teilen] 💰 Bezahlt: ${md.offerLabel || md.offerCode}`,
            html,
          );
        }

        return res.status(200).send("ok");
      } catch (err) {
        console.error("[stripe] webhook verification failed", err);
        return res.status(400).send("invalid signature");
      }
    },
  );

  // --------------------------------------------------------------------------
  // JSON body parsing for everything ELSE (after the webhook)
  // --------------------------------------------------------------------------
  app.use(express.json({ limit: "100kb" }));

  // --------------------------------------------------------------------------
  // POST /api/pilot-checkout
  // --------------------------------------------------------------------------
  const pilotCheckoutLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

  app.post("/api/pilot-checkout", pilotCheckoutLimiter, async (req, res) => {
    const parsed = CreatePilotCheckoutInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(
        res,
        400,
        "validation_error",
        "Die Eingaben sind unvollständig oder ungültig.",
        parsed.error.issues,
      );
    }
    const input = parsed.data;

    if (input.website && input.website.length > 0) {
      return apiError(res, 400, "spam_detected", "Anfrage konnte nicht verarbeitet werden.");
    }

    const offerConfig = PILOT_OFFER_SERVER_CONFIG[input.offerCode];
    const priceId = process.env[offerConfig.stripePriceEnvVar];

    const stripe = await getStripe();
    if (!stripe) {
      return apiError(
        res,
        503,
        "config_missing",
        "Checkout ist aktuell nicht konfiguriert. Bitte versuchen Sie es später erneut.",
      );
    }
    if (!priceId) {
      console.error(
        `[checkout] missing price env var: ${offerConfig.stripePriceEnvVar}`,
      );
      return apiError(
        res,
        503,
        "config_missing",
        `Preisinformation für ${offerConfig.label} fehlt serverseitig.`,
      );
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
        return apiError(
          res,
          500,
          "stripe_error",
          "Checkout-URL konnte nicht erstellt werden.",
        );
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
      return apiError(
        res,
        500,
        "stripe_error",
        "Checkout konnte nicht erstellt werden. Bitte später erneut versuchen.",
      );
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/lead
  // --------------------------------------------------------------------------
  const leadLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

  app.post("/api/lead", leadLimiter, async (req, res) => {
    const parsed = LeadCaptureInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return apiError(
        res,
        400,
        "validation_error",
        "Die Eingaben sind unvollständig oder ungültig.",
        parsed.error.issues,
      );
    }
    const input = parsed.data;

    if (input.website && input.website.length > 0) {
      return apiError(res, 400, "spam_detected", "Anfrage konnte nicht verarbeitet werden.");
    }

    const leadId = randomUUID();

    // Notify the team. No DB needed for v1 — your inbox is the database.
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

  // --------------------------------------------------------------------------
  // GET /api/health — configuration probe (safe; no secrets exposed)
  // --------------------------------------------------------------------------
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      config: {
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
        stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        resend: Boolean(process.env.RESEND_API_KEY),
        prices: {
          et_eligibility: Boolean(process.env.STRIPE_PRICE_ET_ELIGIBILITY),
          et_structuring: Boolean(process.env.STRIPE_PRICE_ET_STRUCTURING),
          et_mandate: Boolean(process.env.STRIPE_PRICE_ET_MANDATE),
        },
        appUrl: process.env.APP_URL || "(unset)",
      },
    });
  });

  // --------------------------------------------------------------------------
  // Reject any other /api/* path with a typed 404 (don't fall through to SPA)
  // --------------------------------------------------------------------------
  app.all("/api/*", (_req, res) =>
    apiError(res, 404, "not_found", "Endpunkt nicht gefunden."),
  );

  // --------------------------------------------------------------------------
  // Static files (production) + SPA fallback
  // --------------------------------------------------------------------------
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
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
      `Configured: stripe=${!!process.env.STRIPE_SECRET_KEY} resend=${!!process.env.RESEND_API_KEY}`,
    );
  });
}

// Auto-start when run directly (e.g. `node dist/index.js`)
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
