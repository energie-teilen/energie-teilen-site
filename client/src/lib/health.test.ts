import { describe, it, expect } from "vitest";
import {
  CAPABILITY_IDS,
  DOCTOR_EXIT,
  REPORTED_ENV_VARS,
  buildHealthReport,
  deriveStatus,
  doctorExitCode,
  isConfiguredValue,
  parseHealthReport,
  renderDoctorReport,
  type HealthInputs,
  type HealthReport,
} from "../../../shared/health";
import { LEGAL_ENTITY, type LegalEntity } from "../../../shared/legal-entity";
import { PILOT_OFFER_SERVER_CONFIG } from "../../../shared/schema";

/*
 * The go-live scoreboard.
 *
 * /api/health and `pnpm doctor` both read shared/health.ts. These tests pin
 * the payload a monitor depends on, the three-way verdict, the doctor's exit
 * codes, and the rule that no configured value ever leaves the server.
 */

const COMPLETE_ENTITY: LegalEntity = {
  configured: true,
  name: "Beispiel Energie GmbH",
  street: "Beispielweg 1",
  postalCode: "60311",
  city: "Frankfurt am Main",
  country: "Deutschland",
  representedBy: "A. Beispiel",
  phone: "+49 69 1234567",
  email: "kontakt@energie-teilen.de",
  registerCourt: "Amtsgericht Frankfurt am Main",
  registerNumber: "HRB 123456",
  vatId: "DE123456789",
  contentResponsible: null,
  disputeResolution: { participates: false, body: null },
};

/** Values shaped like real ones. None of them may appear in a report. */
const SECRETS = {
  STRIPE_SECRET_KEY: "sk_live_51AbCdEfGhIjKlMnOpQrStUvWx",
  STRIPE_WEBHOOK_SECRET: "whsec_ZyXwVuTsRqPoNmLkJiHg1234",
  STRIPE_PRICE_ET_ELIGIBILITY: "price_1QeligibilityAAAA",
  STRIPE_PRICE_ET_STRUCTURING: "price_1QstructuringBBB",
  STRIPE_PRICE_ET_MANDATE: "price_1QmandateCCCCCCCC",
  RESEND_API_KEY: "re_AbCdEfGhIjKlMnOpQrStUv",
  RESEND_FROM_EMAIL: "Energie Teilen <noreply@beispiel-domain.de>",
  LEAD_NOTIFICATION_EMAIL: "auftraege@beispiel-domain.de",
  UPSTASH_REDIS_REST_URL: "https://eu1-sample-12345.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "AXkXASQgZmFrZS10b2tlbi12YWx1ZQ",
  ADMIN_API_TOKEN: "0123456789abcdef0123456789abcdef",
  APP_URL: "https://beispiel-domain.de",
  ET_API_KEYS: "kunde:" + "a".repeat(64),
};

function inputs(over: Partial<HealthInputs> = {}): HealthInputs {
  return {
    env: SECRETS,
    legalEntity: COMPLETE_ENTITY,
    apiKeysConfigured: true,
    production: true,
    ...over,
  };
}

const NOW = new Date("2026-09-11T12:00:00.000Z");
const cap = (r: HealthReport, id: string) => {
  const found = r.capabilities.find((c) => c.id === id);
  if (!found) throw new Error(`capability ${id} not in report`);
  return found;
};

describe("the capability register", () => {
  it("is ordered by what it costs to leave broken", () => {
    expect(CAPABILITY_IDS).toEqual([
      "stripe_secret_key",
      "stripe_price_et_eligibility",
      "stripe_price_et_structuring",
      "stripe_price_et_mandate",
      "app_url",
      "stripe_webhook_secret",
      "legal_entity",
      "resend_api_key",
      "resend_from_email",
      "lead_notification_email",
      "durable_kv",
      "admin_api_token",
      "api_keys",
    ]);
  });

  it("has a price capability for every sellable tier, read from the server config", () => {
    for (const code of Object.keys(PILOT_OFFER_SERVER_CONFIG)) {
      expect(CAPABILITY_IDS).toContain(`stripe_price_${code}`);
    }
  });

  it("gives every capability a cost and a fix, not just a boolean", () => {
    const r = buildHealthReport(inputs({ env: {} }), NOW);
    for (const c of r.capabilities) {
      expect(c.label.length, c.id).toBeGreaterThan(3);
      expect(c.cost_if_missing.length, c.id).toBeGreaterThan(30);
      expect(c.fix.length, c.id).toBeGreaterThan(20);
      expect(c.env.length, c.id).toBeGreaterThan(0);
    }
  });

  it("separates revenue blockers from fulfilment gaps from optional surfaces", () => {
    const r = buildHealthReport(inputs(), NOW);
    const by = (s: string) => r.capabilities.filter((c) => c.severity === s).map((c) => c.id);
    expect(by("revenue_blocker")).toEqual([
      "stripe_secret_key",
      "stripe_price_et_eligibility",
      "stripe_price_et_structuring",
      "stripe_price_et_mandate",
      "app_url",
      "stripe_webhook_secret",
      "legal_entity",
    ]);
    expect(by("fulfilment")).toEqual([
      "resend_api_key",
      "resend_from_email",
      "lead_notification_email",
      "durable_kv",
      "admin_api_token",
    ]);
    expect(by("optional")).toEqual(["api_keys"]);
  });
});

describe("payload shape", () => {
  it("pins the top-level keys a monitor reads", () => {
    const r = buildHealthReport(inputs(), NOW);
    expect(Object.keys(r).sort()).toEqual(
      [
        "capabilities",
        "checks",
        "env",
        "failing",
        "ok",
        "revenueBlocked",
        "status",
        "stripeMode",
        "summary",
        "timestamp",
      ].sort(),
    );
    expect(r.timestamp).toBe("2026-09-11T12:00:00.000Z");
  });

  it("pins the fields of each capability", () => {
    const r = buildHealthReport(inputs({ env: {} }), NOW);
    for (const c of r.capabilities) {
      expect(Object.keys(c).sort()).toEqual(
        ["cost_if_missing", "env", "fix", "id", "label", "present", "problem", "severity"].sort(),
      );
      expect(typeof c.present).toBe("boolean");
    }
  });

  it("reports presence of exactly the documented variables, as booleans", () => {
    const r = buildHealthReport(inputs({ env: { APP_URL: "https://x.de", STRIPE_SECRET_KEY: "" } }), NOW);
    expect(Object.keys(r.env)).toEqual([...REPORTED_ENV_VARS]);
    for (const v of Object.values(r.env)) expect(typeof v).toBe("boolean");
    expect(r.env.APP_URL).toBe(true);
    expect(r.env.STRIPE_SECRET_KEY).toBe(false);
  });

  it("keeps the legacy failing/checks lists, without optional surfaces", () => {
    const r = buildHealthReport(inputs({ env: {}, apiKeysConfigured: false }), NOW);
    expect(r.checks.map((c) => c.check)).not.toContain("api_keys");
    expect(r.failing.map((c) => c.check)).not.toContain("api_keys");
    expect(r.failing.every((f) => f.impact.length > 0)).toBe(true);
  });
});

describe("the verdict", () => {
  it("is ok only when every revenue and fulfilment capability is present", () => {
    const r = buildHealthReport(inputs(), NOW);
    expect(r.status).toBe("ok");
    expect(r.ok).toBe(true);
    expect(r.revenueBlocked).toBe(false);
    expect(r.failing).toEqual([]);
  });

  it("is ok without API keys — an optional surface never fails the deployment", () => {
    const env: Record<string, string> = { ...SECRETS };
    delete env.ET_API_KEYS;
    const r = buildHealthReport(inputs({ env, apiKeysConfigured: false }), NOW);
    expect(r.status).toBe("ok");
    expect(cap(r, "api_keys").present).toBe(false);
    expect(r.summary.missingOptional).toBe(1);
  });

  it("is blocked, not ok, when Stripe is missing", () => {
    const env: Record<string, string> = { ...SECRETS };
    delete env.STRIPE_SECRET_KEY;
    const r = buildHealthReport(inputs({ env }), NOW);
    expect(r.status).toBe("blocked");
    expect(r.ok).toBe(false);
    expect(r.revenueBlocked).toBe(true);
    expect(r.stripeMode).toBeNull();
  });

  it("is blocked when a single tier has no price", () => {
    const env: Record<string, string> = { ...SECRETS };
    delete env.STRIPE_PRICE_ET_MANDATE;
    const r = buildHealthReport(inputs({ env }), NOW);
    expect(r.status).toBe("blocked");
    expect(r.failing.map((f) => f.check)).toEqual(["stripe_price_et_mandate"]);
  });

  it("is blocked while the operator record is not configured — the shipped default", () => {
    expect(LEGAL_ENTITY.configured).toBe(false);
    const r = buildHealthReport(inputs({ legalEntity: LEGAL_ENTITY }), NOW);
    expect(r.status).toBe("blocked");
    expect(cap(r, "legal_entity").present).toBe(false);
    expect(cap(r, "legal_entity").problem).toBeNull();
  });

  it("does not trust configured: true over the record itself", () => {
    const r = buildHealthReport(
      inputs({ legalEntity: { ...COMPLETE_ENTITY, name: "[FIRMENNAME]", phone: "" } }),
      NOW,
    );
    const le = cap(r, "legal_entity");
    expect(le.present).toBe(false);
    expect(le.problem).toMatch(/name/);
    expect(le.problem).toMatch(/phone/);
    expect(le.problem).not.toContain("[FIRMENNAME]");
  });

  it("is degraded, not blocked, when only fulfilment is missing", () => {
    const env: Record<string, string> = { ...SECRETS };
    delete env.RESEND_API_KEY;
    delete env.UPSTASH_REDIS_REST_TOKEN;
    const r = buildHealthReport(inputs({ env }), NOW);
    expect(r.status).toBe("degraded");
    expect(r.revenueBlocked).toBe(false);
    expect(r.summary.missingFulfilment).toBe(2);
    expect(cap(r, "durable_kv").problem).toMatch(/Token fehlt/);
  });

  it("reports everything missing on an empty environment", () => {
    const r = buildHealthReport(
      inputs({ env: {}, legalEntity: LEGAL_ENTITY, apiKeysConfigured: false }),
      NOW,
    );
    expect(r.status).toBe("blocked");
    expect(r.summary).toEqual({
      total: 13,
      present: 0,
      missingRevenueBlockers: 7,
      missingFulfilment: 5,
      missingOptional: 1,
    });
  });

  it("derives the status from the capabilities alone", () => {
    const r = buildHealthReport(inputs(), NOW);
    expect(deriveStatus(r.capabilities)).toBe("ok");
    const broken = r.capabilities.map((c) =>
      c.id === "admin_api_token" ? { ...c, present: false } : c,
    );
    expect(deriveStatus(broken)).toBe("degraded");
  });
});

describe("usability, not mere presence", () => {
  it("does not count a value copied from .env.example as configuration", () => {
    const r = buildHealthReport(
      inputs({
        env: {
          ...SECRETS,
          STRIPE_SECRET_KEY: "sk_test_...",
          STRIPE_WEBHOOK_SECRET: "whsec_...",
          STRIPE_PRICE_ET_ELIGIBILITY: "price_...",
          RESEND_API_KEY: "re_...",
        },
      }),
      NOW,
    );
    for (const id of ["stripe_secret_key", "stripe_webhook_secret", "stripe_price_et_eligibility", "resend_api_key"]) {
      expect(cap(r, id).present, id).toBe(false);
      expect(cap(r, id).problem, id).toMatch(/\.env\.example/);
    }
    // The raw presence map still says the variable is set; the scoreboard says it is useless.
    expect(r.env.STRIPE_SECRET_KEY).toBe(true);
    expect(r.status).toBe("blocked");
    expect(isConfiguredValue("sk_test_...")).toBe(false);
    expect(isConfiguredValue("  ")).toBe(false);
    expect(isConfiguredValue(undefined)).toBe(false);
  });

  it("refuses a localhost or plain-http APP_URL in production, accepts it locally", () => {
    for (const url of ["http://localhost:3000", "http://beispiel-domain.de", "kein-url"]) {
      const prod = buildHealthReport(inputs({ env: { ...SECRETS, APP_URL: url } }), NOW);
      expect(cap(prod, "app_url").present, url).toBe(false);
      expect(cap(prod, "app_url").problem, url).toBeTruthy();
    }
    const dev = buildHealthReport(
      inputs({ production: false, env: { ...SECRETS, APP_URL: "http://localhost:3000" } }),
      NOW,
    );
    expect(cap(dev, "app_url").present).toBe(true);
  });

  it("refuses values that do not have the shape the integration requires", () => {
    const r = buildHealthReport(
      inputs({
        env: {
          ...SECRETS,
          STRIPE_SECRET_KEY: "pk_live_51AbCdEfGhIjKlMn",
          STRIPE_PRICE_ET_STRUCTURING: "prod_1Qabc",
          LEAD_NOTIFICATION_EMAIL: "kein postfach",
          ADMIN_API_TOKEN: "kurz",
          UPSTASH_REDIS_REST_URL: "redis://intern:6379",
        },
      }),
      NOW,
    );
    expect(cap(r, "stripe_secret_key").present).toBe(false);
    expect(cap(r, "stripe_price_et_structuring").present).toBe(false);
    expect(cap(r, "lead_notification_email").present).toBe(false);
    expect(cap(r, "admin_api_token").problem).toMatch(/16 Zeichen/);
    expect(cap(r, "durable_kv").problem).toMatch(/https/);
  });

  it("flags ET_API_KEYS that are set but parse to nothing", () => {
    const r = buildHealthReport(
      inputs({ env: { ...SECRETS, ET_API_KEYS: "kaputt" }, apiKeysConfigured: false }),
      NOW,
    );
    expect(cap(r, "api_keys").present).toBe(false);
    expect(cap(r, "api_keys").problem).toMatch(/label:sha256/);
  });

  it("names the Stripe mode, because test mode moves no real money", () => {
    expect(buildHealthReport(inputs(), NOW).stripeMode).toBe("live");
    expect(
      buildHealthReport(inputs({ env: { ...SECRETS, STRIPE_SECRET_KEY: "sk_test_51AbCdEf" } }), NOW)
        .stripeMode,
    ).toBe("test");
    expect(
      buildHealthReport(inputs({ env: { ...SECRETS, STRIPE_SECRET_KEY: "rk_live_51AbCdEf" } }), NOW)
        .stripeMode,
    ).toBe("live");
  });
});

describe("no secret leaves the server", () => {
  it("never echoes a configured value, in the report or in the doctor output", () => {
    const report = buildHealthReport(inputs(), NOW);
    const withProblems = buildHealthReport(
      inputs({ env: { ...SECRETS, ADMIN_API_TOKEN: "kurz-aber-geheim", STRIPE_SECRET_KEY: "pk_live_geheim123" } }),
      NOW,
    );
    for (const r of [report, withProblems]) {
      const text = JSON.stringify(r) + renderDoctorReport(r, "https://beispiel-domain.de").join("\n");
      for (const [name, value] of Object.entries(SECRETS)) {
        if (name === "APP_URL") continue; // the public origin is not a secret
        expect(text.includes(value), name).toBe(false);
      }
      expect(text).not.toContain("kurz-aber-geheim");
      expect(text).not.toContain("pk_live_geheim123");
    }
  });

  it("contains nothing the e2e security suite would flag as a secret", () => {
    // Same pattern as e2e/security.spec.ts, applied to every state.
    const SECRET_SHAPE = /sk_(live|test)_|whsec_|re_[A-Za-z0-9]{16,}/;
    for (const r of [
      buildHealthReport(inputs(), NOW),
      buildHealthReport(inputs({ env: {}, legalEntity: LEGAL_ENTITY, apiKeysConfigured: false }), NOW),
    ]) {
      expect(JSON.stringify(r)).not.toMatch(SECRET_SHAPE);
    }
  });
});

describe("pnpm doctor", () => {
  it("exits 2 when there is nothing to read", () => {
    expect(doctorExitCode(null)).toBe(DOCTOR_EXIT.unreachable);
    expect(DOCTOR_EXIT.unreachable).toBe(2);
  });

  it("exits 2 on a deployment that predates the scoreboard, rather than guessing", () => {
    const legacy = {
      status: "degraded",
      ok: false,
      failing: [{ check: "stripe", impact: "x" }],
      checks: [{ check: "stripe", ok: false }],
      config: { stripe: false },
    };
    expect(parseHealthReport(legacy)).toBeNull();
    expect(doctorExitCode(parseHealthReport(legacy))).toBe(2);
    expect(parseHealthReport("<!doctype html>")).toBeNull();
    expect(parseHealthReport({ status: "ok", capabilities: [{ id: "x" }] })).toBeNull();
  });

  it("exits 1 on any revenue blocker", () => {
    const r = parseHealthReport(
      JSON.parse(JSON.stringify(buildHealthReport(inputs({ legalEntity: LEGAL_ENTITY }), NOW))),
    );
    expect(r).not.toBeNull();
    expect(doctorExitCode(r)).toBe(DOCTOR_EXIT.revenueBlocked);
    expect(DOCTOR_EXIT.revenueBlocked).toBe(1);
  });

  it("exits 0 when only fulfilment is missing — a warning, not a red build", () => {
    const env: Record<string, string> = { ...SECRETS };
    delete env.ADMIN_API_TOKEN;
    const r = buildHealthReport(inputs({ env }), NOW);
    expect(r.status).toBe("degraded");
    expect(doctorExitCode(r)).toBe(DOCTOR_EXIT.ok);
    expect(DOCTOR_EXIT.ok).toBe(0);
  });

  it("exits 0 when everything is present", () => {
    expect(doctorExitCode(buildHealthReport(inputs(), NOW))).toBe(0);
  });

  it("fails closed when a report's status and scoreboard disagree", () => {
    const r = buildHealthReport(inputs({ legalEntity: LEGAL_ENTITY }), NOW);
    expect(doctorExitCode({ ...r, status: "ok" })).toBe(1);
  });

  it("prints what each blocker costs and how to fix it, blockers first", () => {
    const r = buildHealthReport(
      inputs({ env: {}, legalEntity: LEGAL_ENTITY, apiKeysConfigured: false }),
      NOW,
    );
    const text = renderDoctorReport(r, "https://beispiel-domain.de").join("\n");
    expect(text).toMatch(/UMSATZ BLOCKIERT — 7 Voraussetzung/);
    for (const c of r.capabilities) {
      expect(text).toContain(c.cost_if_missing);
      expect(text).toContain(c.fix);
    }
    expect(text.indexOf("UMSATZ BLOCKIERT")).toBeLessThan(text.indexOf("EINGESCHRÄNKT"));
    expect(text.indexOf("EINGESCHRÄNKT")).toBeLessThan(text.indexOf("OPTIONAL"));
  });

  it("says so when Stripe is in test mode, and gives the verification sequence", () => {
    const r = buildHealthReport(
      inputs({ env: { ...SECRETS, STRIPE_SECRET_KEY: "sk_test_51AbCdEf" } }),
      NOW,
    );
    const text = renderDoctorReport(r, "https://beispiel-domain.de").join("\n");
    expect(text).toMatch(/Testmodus/);
    expect(text).toContain("stripe listen --forward-to https://beispiel-domain.de/api/stripe/webhook");
    expect(text).toMatch(/nur noch Kunden/);
  });
});
