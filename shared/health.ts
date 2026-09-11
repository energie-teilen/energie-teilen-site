/**
 * shared/health.ts
 *
 * The go-live scoreboard: one register of every capability the paid funnel
 * depends on, and one pure function that turns configuration presence into a
 * verdict an operator can act on.
 *
 * Why this exists. The funnel can be fully deployed and still take zero euros,
 * because the things that stop it are not code: a Stripe key, three price IDs,
 * a webhook secret, the operator's own identity. /api/health and `pnpm doctor`
 * both read THIS register, so the endpoint a monitor polls and the checklist a
 * human follows cannot disagree about what is missing, what it costs, or how
 * to fix it.
 *
 * Three severities, because they have different consequences:
 *
 *   revenue_blocker — money cannot be taken, or must not be taken yet.
 *                     Any one of these missing makes the status "blocked" and
 *                     `pnpm doctor` exit 1.
 *   fulfilment      — payment would work; delivery, record-keeping or
 *                     operator visibility would not. Status "degraded".
 *   optional        — a product surface stays closed. Reported, never fails.
 *
 * Rules this module keeps:
 *
 *   - It reports PRESENCE and USABILITY, never a value. No function here
 *     returns, echoes or hashes a configured string; problems are described
 *     in words ("hat nicht die Form einer Stripe-Preis-ID"), not by quoting.
 *   - A value copied verbatim from .env.example ("...") is not configuration.
 *     Counting it as present would be a fake green in the one place that
 *     exists to detect failure.
 *   - It performs no I/O. The server passes in process.env and the few facts
 *     only it can compute; the tests pass in whatever they like.
 *
 * DOM-free and dependency-light, so the doctor script can import it through
 * tsx and the unit suite can pin it without a running server.
 */

import { PILOT_OFFER_SERVER_CONFIG, type PilotOfferCode } from "./schema.js";
import { validateLegalEntity, type LegalEntity } from "./legal-entity.js";

// ============================================================================
// TYPES
// ============================================================================

export const CAPABILITY_SEVERITIES = ["revenue_blocker", "fulfilment", "optional"] as const;
export type CapabilitySeverity = (typeof CAPABILITY_SEVERITIES)[number];

export const HEALTH_STATUSES = ["ok", "degraded", "blocked"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** Environment variables whose presence the health endpoint reports. Names only. */
export const REPORTED_ENV_VARS = [
  "APP_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ET_ELIGIBILITY",
  "STRIPE_PRICE_ET_STRUCTURING",
  "STRIPE_PRICE_ET_MANDATE",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "LEAD_NOTIFICATION_EMAIL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "ADMIN_API_TOKEN",
  "ET_API_KEYS",
] as const;
export type ReportedEnvVar = (typeof REPORTED_ENV_VARS)[number];

export type EnvLike = Readonly<Record<string, string | undefined>>;

export type CapabilityState = {
  /** Stable machine id. Monitors and the doctor key on this. */
  id: string;
  /** Short German label. */
  label: string;
  severity: CapabilitySeverity;
  /** True only when configured AND usable. */
  present: boolean;
  /** Names of the variables (or the file) that supply it. Never values. */
  env: string[];
  /** What it costs while it stays missing, in plain German. */
  cost_if_missing: string;
  /** The exact operator action that resolves it. */
  fix: string;
  /** Set when something IS configured but cannot be used. Never quotes the value. */
  problem: string | null;
};

export type StripeMode = "live" | "test" | null;

export type HealthReport = {
  status: HealthStatus;
  /** True only for status "ok". Kept for monitors that read a boolean. */
  ok: boolean;
  timestamp: string;
  /** True when at least one revenue blocker is missing. */
  revenueBlocked: boolean;
  /** Derived from the key prefix. Test mode moves no real money. */
  stripeMode: StripeMode;
  summary: {
    total: number;
    present: number;
    missingRevenueBlockers: number;
    missingFulfilment: number;
    missingOptional: number;
  };
  /** The scoreboard, ordered by what it costs to leave broken. */
  capabilities: CapabilityState[];
  /** Presence of each reported variable. Booleans only. */
  env: Record<ReportedEnvVar, boolean>;
  /** Legacy shape: non-optional capabilities that are missing. */
  failing: { check: string; impact: string }[];
  /** Legacy shape: every non-optional capability. */
  checks: { check: string; ok: boolean }[];
};

export type HealthInputs = {
  env: EnvLike;
  /** The operator record from shared/legal-entity.ts. */
  legalEntity: LegalEntity;
  /**
   * Whether ET_API_KEYS parses to at least one valid entry. Computed by
   * server/api-keys.ts, which owns that format, and passed in here so the
   * parsing rule exists once.
   */
  apiKeysConfigured: boolean;
  /** NODE_ENV === "production". Localhost and plain http are refused there. */
  production: boolean;
};

// ============================================================================
// VALUE CHECKS — shape only, never content
// ============================================================================

/** Trimmed, non-empty, and not a template value copied from .env.example. */
export function isConfiguredValue(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0) return false;
  // .env.example ships "sk_test_...", "whsec_...", "price_...", "re_...".
  if (/(\.\.\.|…)\s*$/.test(v)) return false;
  return true;
}

const EMAIL_PATTERN = /[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+/;

function stripeModeOf(key: string | undefined): StripeMode {
  if (!isConfiguredValue(key)) return null;
  if (/^(sk|rk)_live_/.test(key.trim())) return "live";
  if (/^(sk|rk)_test_/.test(key.trim())) return "test";
  return null;
}

type Check = { present: boolean; problem: string | null };

const MISSING: Check = { present: false, problem: null };
const PRESENT: Check = { present: true, problem: null };
const unusable = (problem: string): Check => ({ present: false, problem });

/** A set-but-template value is reported as a problem, not as silence. */
function templateOr(value: string | undefined, next: (v: string) => Check): Check {
  if (typeof value === "string" && value.trim().length > 0 && !isConfiguredValue(value)) {
    return unusable("Enthält noch den Beispielwert aus .env.example.");
  }
  if (!isConfiguredValue(value)) return MISSING;
  return next(value.trim());
}

function checkAppUrl(value: string | undefined, production: boolean): Check {
  return templateOr(value, (v) => {
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      return unusable("Gesetzt, aber keine absolute Adresse.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return unusable("Gesetzt, aber keine http(s)-Adresse.");
    }
    if (production) {
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(url.hostname)) {
        return unusable("Zeigt im Produktivbetrieb auf eine lokale Adresse; Stripe leitet Käufer dorthin zurück.");
      }
      if (url.protocol !== "https:") {
        return unusable("Im Produktivbetrieb ohne https.");
      }
    }
    return PRESENT;
  });
}

function checkPrefix(value: string | undefined, pattern: RegExp, problem: string): Check {
  return templateOr(value, (v) => (pattern.test(v) ? PRESENT : unusable(problem)));
}

function checkEmail(value: string | undefined): Check {
  return templateOr(value, (v) =>
    EMAIL_PATTERN.test(v) ? PRESENT : unusable("Gesetzt, aber enthält keine E-Mail-Adresse."),
  );
}

// ============================================================================
// THE REGISTER
// ============================================================================

type CapabilityDefinition = Omit<CapabilityState, "present" | "problem"> & {
  evaluate: (inputs: HealthInputs) => Check;
};

function priceCapability(code: PilotOfferCode): CapabilityDefinition {
  const cfg = PILOT_OFFER_SERVER_CONFIG[code];
  const envVar = cfg.stripePriceEnvVar;
  return {
    id: `stripe_price_${code}`,
    label: `Stripe-Preis „${cfg.label}“`,
    severity: "revenue_blocker",
    env: [envVar],
    cost_if_missing: `Die Stufe „${cfg.label}“ hat keinen Preis. Ihr Checkout antwortet mit 503; wer diese Stufe wählt, kann nicht bezahlen.`,
    fix: `In Stripe ein einmaliges Produkt mit Preis in EUR anlegen und die Preis-ID (beginnt mit price_) als ${envVar} setzen. Nur serverseitig — der Browser erfährt keine Preis-ID.`,
    evaluate: ({ env }) =>
      checkPrefix(env[envVar], /^price_[A-Za-z0-9]+$/, "Gesetzt, aber keine Stripe-Preis-ID."),
  };
}

/**
 * Ordered by what it costs to leave broken, not by where it sits in the stack:
 * first what stops a payment, then what stops a paid order being recorded and
 * delivered, then what keeps a product surface closed.
 */
const REGISTER: CapabilityDefinition[] = [
  {
    id: "stripe_secret_key",
    label: "Stripe Secret Key",
    severity: "revenue_blocker",
    env: ["STRIPE_SECRET_KEY"],
    cost_if_missing:
      "Der Checkout antwortet jedem Besucher mit 503. Es ist keine Zahlung möglich, egal wie gut der Rest funktioniert.",
    fix: "Stripe → Developers → API keys: den Secret Key als STRIPE_SECRET_KEY in Vercel setzen (Production), dann neu deployen. Zuerst den Testschlüssel, nach einem erfolgreichen Testkauf den Live-Schlüssel.",
    evaluate: ({ env }) =>
      checkPrefix(
        env.STRIPE_SECRET_KEY,
        /^(sk|rk)_(live|test)_[A-Za-z0-9]+$/,
        "Gesetzt, aber hat nicht die Form eines Stripe-Secret-Keys.",
      ),
  },
  ...(Object.keys(PILOT_OFFER_SERVER_CONFIG) as PilotOfferCode[]).map(priceCapability),
  {
    id: "app_url",
    label: "Öffentliche Adresse (APP_URL)",
    severity: "revenue_blocker",
    env: ["APP_URL"],
    cost_if_missing:
      "Stripe leitet Käufer nach der Zahlung auf localhost statt auf diese Website zurück. Die Bestätigungsseite erscheint nie, der Käufer sieht einen Fehler.",
    fix: "APP_URL auf die öffentliche https-Adresse der Website setzen (ohne abschließenden Schrägstrich), dann neu deployen.",
    evaluate: ({ env, production }) => checkAppUrl(env.APP_URL, production),
  },
  {
    id: "stripe_webhook_secret",
    label: "Stripe Webhook Secret",
    severity: "revenue_blocker",
    env: ["STRIPE_WEBHOOK_SECRET"],
    cost_if_missing:
      "Zahlungen gehen ein, aber nichts wird erfasst: kein Auftrag im Ledger, keine Bestätigung an den Kunden. Der Webhook antwortet mit 503, bis das Secret gesetzt ist.",
    fix: "Stripe → Developers → Webhooks: Endpoint <APP_URL>/api/stripe/webhook für checkout.session.completed und checkout.session.async_payment_succeeded anlegen und dessen Signing Secret als STRIPE_WEBHOOK_SECRET setzen.",
    evaluate: ({ env }) =>
      checkPrefix(
        env.STRIPE_WEBHOOK_SECRET,
        /^whsec_[A-Za-z0-9+/=]+$/,
        "Gesetzt, aber hat nicht die Form eines Stripe-Signing-Secrets.",
      ),
  },
  {
    id: "legal_entity",
    label: "Anbieterangaben (Impressum)",
    severity: "revenue_blocker",
    env: ["shared/legal-entity.ts"],
    cost_if_missing:
      "Impressum, AGB und Bestätigungen nennen keinen Anbieter. Eine Seite, die Geld annimmt, ohne ihren Betreiber zu nennen, ist nicht veröffentlichungsfähig; der Release-Check schlägt fehl.",
    fix: "shared/legal-entity.ts mit den echten Angaben füllen und configured auf true setzen. Prüfen mit: RELEASE_CHECK=1 pnpm test -- client/src/lib/legal-entity.test.ts",
    evaluate: ({ legalEntity }) => {
      const problems = validateLegalEntity(legalEntity);
      if (!legalEntity.configured) return MISSING;
      if (problems.length > 0) {
        return unusable(
          `configured ist true, aber ${problems.length} Angabe(n) fehlen oder sind Platzhalter: ${problems
            .map((p) => p.field)
            .join(", ")}.`,
        );
      }
      return PRESENT;
    },
  },
  {
    id: "resend_api_key",
    label: "E-Mail-Versand (Resend)",
    severity: "fulfilment",
    env: ["RESEND_API_KEY"],
    cost_if_missing:
      "Der Kunde zahlt und erhält nichts von Ihnen. Leads und Zahlungsmeldungen erreichen niemanden — ohne Ledger ist damit auch der letzte Auftragsnachweis weg. Erstattungsrisiko.",
    fix: "Bei Resend die eigene Domain verifizieren und den API-Key als RESEND_API_KEY setzen.",
    evaluate: ({ env }) => templateOr(env.RESEND_API_KEY, () => PRESENT),
  },
  {
    id: "resend_from_email",
    label: "Absenderadresse",
    severity: "fulfilment",
    env: ["RESEND_FROM_EMAIL"],
    cost_if_missing:
      "Versendet wird mit dem eingebauten Standardabsender. Ist dessen Domain bei Resend nicht verifiziert, wird jede Bestätigung abgelehnt.",
    fix: "RESEND_FROM_EMAIL auf einen Absender der bei Resend verifizierten Domain setzen, Format: Energie Teilen <noreply@ihre-domain.de>. Keine private Postfachadresse.",
    evaluate: ({ env }) => checkEmail(env.RESEND_FROM_EMAIL),
  },
  {
    id: "lead_notification_email",
    label: "Postfach für Leads und Aufträge",
    severity: "fulfilment",
    env: ["LEAD_NOTIFICATION_EMAIL"],
    cost_if_missing:
      "Neue Leads und bezahlte Aufträge werden niemandem gemeldet. Die Kundenbestätigung nennt eine Standardadresse, falls ET_CUSTOMER_REPLY_TO fehlt.",
    fix: "LEAD_NOTIFICATION_EMAIL auf ein überwachtes Postfach der eigenen Domain setzen.",
    evaluate: ({ env }) => checkEmail(env.LEAD_NOTIFICATION_EMAIL),
  },
  {
    id: "durable_kv",
    label: "Auftrags-Ledger (Upstash Redis)",
    severity: "fulfilment",
    env: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    cost_if_missing:
      "Ein bezahlter Auftrag existiert nur in Stripe und in einer E-Mail: nicht auflistbar, nicht nachverfolgbar. Rate-Limits gelten nur pro Instanz, die Webhook-Idempotenz ist nur bestmöglich.",
    fix: "Bei Upstash eine Redis-Datenbank anlegen und UPSTASH_REDIS_REST_URL sowie UPSTASH_REDIS_REST_TOKEN setzen.",
    evaluate: ({ env }) => {
      const url = templateOr(env.UPSTASH_REDIS_REST_URL, (v) =>
        /^https:\/\//.test(v) ? PRESENT : unusable("UPSTASH_REDIS_REST_URL ist keine https-Adresse."),
      );
      const token = templateOr(env.UPSTASH_REDIS_REST_TOKEN, () => PRESENT);
      if (url.present && token.present) return PRESENT;
      if (url.problem) return url;
      if (token.problem) return token;
      if (url.present) return unusable("Nur UPSTASH_REDIS_REST_URL ist gesetzt; der Token fehlt.");
      if (token.present) return unusable("Nur UPSTASH_REDIS_REST_TOKEN ist gesetzt; die URL fehlt.");
      return MISSING;
    },
  },
  {
    id: "admin_api_token",
    label: "Admin-Zugang zum Ledger",
    severity: "fulfilment",
    env: ["ADMIN_API_TOKEN"],
    cost_if_missing:
      "Offene Aufträge, ihr Wert und was überfällig ist, lassen sich nicht abrufen. /api/admin/orders bleibt deaktiviert.",
    fix: "ADMIN_API_TOKEN auf mindestens 32 zufällige Zeichen setzen: openssl rand -hex 32",
    evaluate: ({ env }) =>
      templateOr(env.ADMIN_API_TOKEN, (v) =>
        v.length >= 16
          ? PRESENT
          : unusable("Kürzer als 16 Zeichen; die Admin-Schnittstelle bleibt deshalb deaktiviert."),
      ),
  },
  {
    id: "api_keys",
    label: "API-Schlüssel für /api/v1",
    severity: "optional",
    env: ["ET_API_KEYS"],
    cost_if_missing:
      "Die Rechen-API antwortet jedem mit 401. Kein Integrator kann sie nutzen, und es gibt keinen API-Zugang, der verkauft werden könnte.",
    fix: "Einen Schlüssel ausgeben mit: pnpm apikey:new <kunde>. Nur das Paar label:hash in ET_API_KEYS eintragen, nie den Klartext.",
    evaluate: ({ env, apiKeysConfigured }) => {
      if (apiKeysConfigured) return PRESENT;
      if (typeof env.ET_API_KEYS === "string" && env.ET_API_KEYS.trim().length > 0) {
        return unusable("Gesetzt, aber ohne gültigen Eintrag der Form label:sha256-hash.");
      }
      return MISSING;
    },
  },
];

/** Capability ids in scoreboard order. Pinned by the tests. */
export const CAPABILITY_IDS: readonly string[] = REGISTER.map((c) => c.id);

// ============================================================================
// THE VERDICT
// ============================================================================

export function evaluateCapabilities(inputs: HealthInputs): CapabilityState[] {
  return REGISTER.map(({ evaluate, ...def }) => {
    const { present, problem } = evaluate(inputs);
    return { ...def, env: [...def.env], present, problem };
  });
}

export function deriveStatus(capabilities: CapabilityState[]): HealthStatus {
  const missing = capabilities.filter((c) => !c.present);
  if (missing.some((c) => c.severity === "revenue_blocker")) return "blocked";
  if (missing.some((c) => c.severity === "fulfilment")) return "degraded";
  return "ok";
}

export function buildHealthReport(inputs: HealthInputs, now: Date = new Date()): HealthReport {
  const capabilities = evaluateCapabilities(inputs);
  const status = deriveStatus(capabilities);
  const missing = (s: CapabilitySeverity) =>
    capabilities.filter((c) => c.severity === s && !c.present).length;
  const gating = capabilities.filter((c) => c.severity !== "optional");

  const env = Object.fromEntries(
    REPORTED_ENV_VARS.map((name) => {
      const raw = inputs.env[name];
      return [name, typeof raw === "string" && raw.trim().length > 0];
    }),
  ) as Record<ReportedEnvVar, boolean>;

  return {
    status,
    ok: status === "ok",
    timestamp: now.toISOString(),
    revenueBlocked: status === "blocked",
    stripeMode: stripeModeOf(inputs.env.STRIPE_SECRET_KEY),
    summary: {
      total: capabilities.length,
      present: capabilities.filter((c) => c.present).length,
      missingRevenueBlockers: missing("revenue_blocker"),
      missingFulfilment: missing("fulfilment"),
      missingOptional: missing("optional"),
    },
    capabilities,
    env,
    failing: gating
      .filter((c) => !c.present)
      .map((c) => ({ check: c.id, impact: c.cost_if_missing })),
    checks: gating.map((c) => ({ check: c.id, ok: c.present })),
  };
}

// ============================================================================
// THE DOCTOR — reading a report back
// ============================================================================

/** Exit codes of `pnpm doctor`. */
export const DOCTOR_EXIT = {
  /** No revenue blocker. Fulfilment gaps are printed but do not fail. */
  ok: 0,
  /** At least one revenue blocker: money cannot move. */
  revenueBlocked: 1,
  /** The site could not be reached, or did not answer with a scoreboard. */
  unreachable: 2,
} as const;
export type DoctorExitCode = (typeof DOCTOR_EXIT)[keyof typeof DOCTOR_EXIT];

/**
 * Structural check of a /api/health body. Returns null for anything that is
 * not a scoreboard — including a deployment older than the scoreboard — so the
 * doctor never guesses a verdict from a shape it does not understand.
 */
export function parseHealthReport(body: unknown): HealthReport | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Partial<HealthReport>;
  if (!HEALTH_STATUSES.includes(b.status as HealthStatus)) return null;
  if (!Array.isArray(b.capabilities) || b.capabilities.length === 0) return null;
  for (const c of b.capabilities as Partial<CapabilityState>[]) {
    if (
      typeof c?.id !== "string" ||
      typeof c.present !== "boolean" ||
      !CAPABILITY_SEVERITIES.includes(c.severity as CapabilitySeverity) ||
      typeof c.cost_if_missing !== "string" ||
      typeof c.fix !== "string"
    ) {
      return null;
    }
  }
  return b as HealthReport;
}

/**
 * The verdict is recomputed from the capabilities rather than read from
 * `status`, so a report whose summary and scoreboard disagree fails closed.
 */
export function doctorExitCode(report: HealthReport | null): DoctorExitCode {
  if (!report) return DOCTOR_EXIT.unreachable;
  const blocked = report.capabilities.some((c) => c.severity === "revenue_blocker" && !c.present);
  return blocked || report.status === "blocked" ? DOCTOR_EXIT.revenueBlocked : DOCTOR_EXIT.ok;
}

const MARK: Record<CapabilitySeverity, string> = {
  revenue_blocker: "✗",
  fulfilment: "!",
  optional: "·",
};

/** Plain-text checklist. The doctor prints it; the tests read it. */
export function renderDoctorReport(report: HealthReport, base: string): string[] {
  const out: string[] = [];
  for (const c of report.capabilities) {
    out.push(`  ${c.present ? "✓" : MARK[c.severity]} ${c.label}${c.problem ? ` — ${c.problem}` : ""}`);
  }
  out.push("");

  const section = (severity: CapabilitySeverity) =>
    report.capabilities.filter((c) => c.severity === severity && !c.present);
  const describe = (c: CapabilityState, prefix: string) => {
    out.push(`${prefix} ${c.label} [${c.id}]`);
    if (c.problem) out.push(`   Befund: ${c.problem}`);
    out.push(`   Kostet Sie: ${c.cost_if_missing}`);
    out.push(`   Behebung: ${c.fix}`);
    out.push("");
  };

  const blockers = section("revenue_blocker");
  if (blockers.length > 0) {
    out.push(
      `UMSATZ BLOCKIERT — ${blockers.length} Voraussetzung(en) für Zahlungen fehlen. Solange sie fehlen, bewegt sich kein Euro.`,
    );
    out.push("");
    blockers.forEach((c, i) => describe(c, `${i + 1}.`));
  } else {
    out.push("Zahlungsweg ist konfiguriert.");
    if (report.stripeMode === "test") {
      out.push(
        "Stripe läuft im Testmodus: der Weg ist prüfbar, aber es fließt kein echtes Geld. Nach dem Testkauf auf den Live-Schlüssel wechseln.",
      );
    }
    out.push("Bevor Sie sich darauf verlassen, einmal von Ende zu Ende durchspielen:");
    out.push(`  stripe listen --forward-to ${base}/api/stripe/webhook`);
    out.push("  dann eine Stufe mit der Testkarte 4242 4242 4242 4242 kaufen und prüfen:");
    out.push("  Bestätigungsseite → Kunden-E-Mail → Auftrag in /api/admin/orders");
    out.push("");
  }

  const degraded = section("fulfilment");
  if (degraded.length > 0) {
    out.push("EINGESCHRÄNKT — Zahlung würde funktionieren, die Erfüllung nicht vollständig.");
    out.push("");
    degraded.forEach((c) => describe(c, "·"));
  }

  const optional = section("optional");
  if (optional.length > 0) {
    out.push("OPTIONAL — geschlossene Produktflächen, kein Einfluss auf den Status.");
    out.push("");
    optional.forEach((c) => describe(c, "·"));
  }

  if (blockers.length === 0 && degraded.length === 0) {
    out.push("Alles konfiguriert. Zwischen Ihnen und Umsatz stehen jetzt nur noch Kunden.");
  }
  return out;
}
