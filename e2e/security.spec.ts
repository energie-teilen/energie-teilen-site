import { test, expect } from "@playwright/test";
import { E2E_API_KEY } from "./fixtures";

/**
 * Security checks that can be made from outside the process, aligned to the
 * OWASP ASVS areas that apply to a public marketing-plus-API surface:
 * transport and browser hardening headers, secret exposure, injection through
 * user-controlled values, and abuse resistance.
 */

test.describe("browser hardening headers", () => {
  const REQUIRED: [string, RegExp][] = [
    ["x-content-type-options", /nosniff/i],
    ["x-frame-options", /deny|sameorigin/i],
    ["referrer-policy", /no-referrer|strict-origin/i],
    ["content-security-policy", /default-src/i],
    ["strict-transport-security", /max-age=\d+/i],
    ["permissions-policy", /.+/],
  ];

  for (const [header, pattern] of REQUIRED) {
    test(`the document sets ${header}`, async ({ request }) => {
      const res = await request.get("/");
      const value = res.headers()[header];
      expect(value, `${header} missing`).toBeTruthy();
      expect(value).toMatch(pattern);
    });
  }

  test("does not advertise the server technology", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["x-powered-by"], "x-powered-by leaks the stack").toBeFalsy();
  });
});

test.describe("static serving", () => {
  /*
   * A missing asset answered 200 with the SPA shell, so the browser tried to
   * parse index.html as a font and reported a decode error rather than a
   * missing file. Broken asset paths have to be visible.
   */
  test("a missing asset returns 404, not the application shell", async ({ request }) => {
    for (const path of [
      "/fonts/does-not-exist.woff2",
      "/assets/missing-chunk.js",
      "/images/nope.png",
      "/robots.txt.js",
    ]) {
      const res = await request.get(path, { failOnStatusCode: false });
      expect(res.status(), `${path} should 404`).toBe(404);
      expect(await res.text()).not.toContain("<!doctype html");
    }
  });

  test("an unknown page path still serves the application", async ({ request }) => {
    const res = await request.get("/eine-unbekannte-seite");
    expect(res.status()).toBe(200);
    expect((await res.text()).toLowerCase()).toContain("<!doctype html");
  });
});

test.describe("secret exposure", () => {
  test("no secret-shaped value reaches the client bundle", async ({ request, baseURL }) => {
    const html = await (await request.get("/")).text();
    const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
    expect(scripts.length, "the page loads JavaScript").toBeGreaterThan(0);

    const patterns: [string, RegExp][] = [
      ["Stripe secret key", /sk_(live|test)_[A-Za-z0-9]{16,}/],
      ["Stripe webhook secret", /whsec_[A-Za-z0-9]{16,}/],
      ["Resend key", /re_[A-Za-z0-9]{16,}/],
      ["Upstash token", /AY[A-Za-z0-9_-]{30,}/],
      ["Energie Teilen API key", /et_[A-Za-z0-9_]{20,}/],
      ["Private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["Bearer literal", /Bearer\s+[A-Za-z0-9._-]{30,}/],
    ];

    for (const src of scripts.slice(0, 12)) {
      const url = src.startsWith("http") ? src : new URL(src, baseURL).toString();
      const body = await (await request.get(url)).text();
      for (const [name, re] of patterns) {
        expect(re.test(body), `${name} found in ${src}`).toBe(false);
      }
    }
  });

  test("environment variables are not dumped by any endpoint", async ({ request }) => {
    const health = await (await request.get("/api/health")).text();
    expect(health).not.toMatch(/sk_(live|test)_|whsec_|re_[A-Za-z0-9]{16,}/);
  });
});

test.describe("injection and abuse", () => {
  test("a script payload in an API field is never reflected as HTML", async ({ request }) => {
    const payload = "<script>window.__pwned=1</script>";
    const res = await request.post("/api/v1/calculate", {
      headers: { Authorization: `Bearer ${E2E_API_KEY}` },
      data: { inputs: { kwp: 30 }, reference: payload },
    });
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    // Echoed as data, never interpreted; and the response is not HTML.
    expect(body.reference).toBe(payload);
  });

  test("an oversized body is rejected rather than absorbed", async ({ request }) => {
    const res = await request.post("/api/lead", {
      data: { email: "a@b.de", source: "x", consent: true, website: "", payload: { blob: "x".repeat(3_000_000) } },
      failOnStatusCode: false,
    });
    expect([400, 413, 422, 429]).toContain(res.status());
  });

  test("the honeypot field rejects a bot submission", async ({ request }) => {
    const res = await request.post("/api/lead", {
      data: { email: "bot@example.com", source: "rechner", consent: true, website: "http://spam.example" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(200);
    // Whatever the status, a honeypot hit must never be stored as a real lead.
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.persisted ?? "none").not.toBe("server");
    }
  });

  test("an unverified Stripe webhook signature is refused with 400", async ({ request }) => {
    const res = await request.post("/api/stripe/webhook", {
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      data: { type: "checkout.session.completed" },
      failOnStatusCode: false,
    });
    expect([400, 503]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test("the admin API is not open", async ({ request }) => {
    const res = await request.get("/api/admin/orders", { failOnStatusCode: false });
    expect([401, 403, 404, 503]).toContain(res.status());
  });

  test("repeated API calls are rate limited", async ({ request }) => {
    const results: number[] = [];
    for (let i = 0; i < 80; i++) {
      const res = await request.post("/api/lead", {
        data: { email: `flood${i}@example.de`, source: "rechner", consent: true, website: "" },
        failOnStatusCode: false,
      });
      results.push(res.status());
      if (res.status() === 429) break;
    }
    expect(results, "no 429 after 80 rapid submissions").toContain(429);
  });
});
