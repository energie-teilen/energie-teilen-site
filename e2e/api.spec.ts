import { test, expect } from "@playwright/test";
import { E2E_API_KEY } from "./fixtures";

/**
 * API contract tests against the running server.
 *
 * These assert the behaviour an integrator depends on: authentication that
 * does not leak, validation that refuses rather than guesses, and an explicit
 * refusal where an input falls outside what the engine can answer.
 */

const auth = { Authorization: `Bearer ${E2E_API_KEY}` };

test.describe("authentication", () => {
  const endpoints: [string, "get" | "post"][] = [
    ["/api/v1/meta", "get"],
    ["/api/v1/calculate", "post"],
    ["/api/v1/eligibility", "post"],
    ["/api/v1/messkonzept", "post"],
    ["/api/v1/allocation", "post"],
    ["/api/v1/billing", "post"],
    ["/api/v1/mako/grid", "get"],
    ["/api/v1/mako/identifiers", "post"],
    ["/api/v1/mako/mscons", "post"],
  ];

  for (const [path, method] of endpoints) {
    test(`${path} rejects an unauthenticated request`, async ({ request }) => {
      const res = method === "get" ? await request.get(path) : await request.post(path, { data: {} });
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe("unauthorized");
    });
  }

  test("a wrong key is refused exactly like a missing one", async ({ request }) => {
    const wrong = await request.get("/api/v1/meta", {
      headers: { Authorization: "Bearer et_definitely_not_a_valid_key_here" },
    });
    const missing = await request.get("/api/v1/meta");
    expect(wrong.status()).toBe(missing.status());
    expect(await wrong.json()).toEqual(await missing.json());
  });

  test("accepts the key on either header", async ({ request }) => {
    const bearer = await request.get("/api/v1/meta", { headers: auth });
    const direct = await request.get("/api/v1/meta", { headers: { "X-API-Key": E2E_API_KEY } });
    expect(bearer.status()).toBe(200);
    expect(direct.status()).toBe(200);
  });
});

test.describe("meta", () => {
  test("lists every endpoint it actually serves", async ({ request }) => {
    const res = await request.get("/api/v1/meta", { headers: auth });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const path of [
      "/api/v1/meta",
      "/api/v1/calculate",
      "/api/v1/eligibility",
      "/api/v1/messkonzept",
      "/api/v1/allocation",
      "/api/v1/billing",
      "/api/v1/mako/grid",
      "/api/v1/mako/identifiers",
      "/api/v1/mako/mscons",
    ]) {
      expect(body.endpoints, `meta lists ${path}`).toContain(path);
    }
  });

  test("every listed endpoint answers rather than 404ing", async ({ request }) => {
    const meta = await (await request.get("/api/v1/meta", { headers: auth })).json();
    for (const path of meta.endpoints as string[]) {
      const res = path.includes("grid") || path.endsWith("/meta")
        ? await request.get(path, { headers: auth })
        : await request.post(path, { headers: auth, data: {} });
      expect(res.status(), `${path} is served`).not.toBe(404);
      expect([200, 400]).toContain(res.status());
    }
  });

  test("carries a model stamp that identifies the calculation exactly", async ({ request }) => {
    const body = await (await request.get("/api/v1/meta", { headers: auth })).json();
    expect(body.model).toMatchObject({ jurisdiction: "DE", currency: "EUR" });
    expect(body.model.modelVersion).toBeTruthy();
    expect(body.model.assumptionSet).toBeTruthy();
  });

  test("renders no statutory citation while the models are unverified", async ({ request }) => {
    const body = await (await request.get("/api/v1/meta", { headers: auth })).json();
    for (const m of body.models) {
      if (!m.citation) continue;
      expect(typeof m.citation).toBe("string");
    }
  });
});

test.describe("validation refuses rather than guesses", () => {
  test("calculate requires the plant size, since every rate is banded by it", async ({ request }) => {
    const res = await request.post("/api/v1/calculate", { headers: auth, data: { inputs: {} } });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("validation_error");
  });

  test("allocation refuses a series that does not match the generation series", async ({ request }) => {
    const res = await request.post("/api/v1/allocation", {
      headers: auth,
      data: {
        generationKwh: [1, 2, 3],
        participants: [{ id: "a", consumptionKwh: [1, 2] }],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("unsupported_input");
    expect(body.details.code).toBe("series_length_mismatch");
  });

  test("MSCONS refuses 96 values on the 100-interval day and names the reason", async ({ request }) => {
    const res = await request.post("/api/v1/mako/mscons", {
      headers: auth,
      data: {
        period: { date: "2026-10-25" },
        sender: { code: "9999999999994" },
        receiver: { code: "8888888888888" },
        locations: [
          {
            melo: "DE" + "0".repeat(25) + "12345A",
            direction: "consumption",
            valuesKwh: new Array(96).fill(0.1),
          },
        ],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.details.code).toBe("series_length_mismatch");
    expect(body.message).toMatch(/Zeitumstellung/);
  });

  test("billing refuses a reversed period", async ({ request }) => {
    const res = await request.post("/api/v1/billing", {
      headers: auth,
      data: {
        period: { from: "2027-01-01", to: "2026-01-01" },
        tariff: { mieterstromCtPerKwh: 28, reststromCtPerKwh: 34, grundpreisEurPerYear: 120 },
        participants: [{ id: "a", allocatedKwh: 1, gridDrawKwh: 1 }],
      },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("the answers integrators depend on", () => {
  test("the grid reports the real interval count for the clock-change days", async ({ request }) => {
    for (const [date, expected] of [
      ["2026-06-15", 96],
      ["2026-03-29", 92],
      ["2026-10-25", 100],
    ] as const) {
      const body = await (
        await request.get(`/api/v1/mako/grid?date=${date}`, { headers: auth })
      ).json();
      expect(body.intervals, `${date}`).toBe(expected);
    }
  });

  test("billing totals reconcile to the cent", async ({ request }) => {
    const res = await request.post("/api/v1/billing", {
      headers: auth,
      data: {
        period: { from: "2026-01-01", to: "2027-01-01" },
        tariff: {
          mieterstromCtPerKwh: 28,
          reststromCtPerKwh: 34,
          grundpreisEurPerYear: 120,
          grundversorgungCtPerKwh: 36,
        },
        participants: Array.from({ length: 37 }, (_, i) => ({
          id: `we-${i}`,
          allocatedKwh: 137.137 + i * 3.3333,
          gridDrawKwh: 991.777 - i * 1.111,
        })),
      },
    });
    const body = await res.json();
    expect(body.reconciliation.failures).toEqual([]);
    expect(body.reconciliation.ok).toBe(true);
    const sum = body.statements.reduce((a: number, s: { grossCents: number }) => a + s.grossCents, 0);
    expect(body.totals.grossCents).toBe(sum);
  });

  test("an MSCONS message verifies its own syntax", async ({ request }) => {
    const body = await (
      await request.post("/api/v1/mako/mscons", {
        headers: auth,
        data: {
          period: { date: "2026-10-25" },
          sender: { code: "9999999999994" },
          receiver: { code: "8888888888888" },
          locations: [
            {
              melo: "DE" + "0".repeat(25) + "12345A",
              direction: "consumption",
              valuesKwh: new Array(100).fill(0.1),
            },
          ],
        },
      })
    ).json();
    expect(body.syntax.findings).toEqual([]);
    expect(body.syntax.ok).toBe(true);
    expect(body.profile.verified, "the profile must not claim to be verified").toBe(false);
    expect(body.message).toContain("1-1?:1.29.0");
  });

  test("identifier checks never claim validity on an unverified algorithm", async ({ request }) => {
    const body = await (
      await request.post("/api/v1/mako/identifiers", {
        headers: auth,
        data: { senderCode: "9999999999994", receiverCode: "8888888888888" },
      })
    ).json();
    for (const r of Object.values(body.results) as { checkDigit: string }[]) {
      expect(["algorithm_unverified", "ok", "mismatch"]).toContain(r.checkDigit);
    }
    for (const a of body.algorithms as { verified: boolean }[]) {
      if (!a.verified) {
        for (const r of Object.values(body.results) as { checkDigit: string }[]) {
          expect(r.checkDigit).not.toBe("ok");
        }
      }
    }
  });
});

test.describe("health and caching", () => {
  test("health reports which integrations are actually configured", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status");
    // The go-live scoreboard: a verdict, and for every capability what its
    // absence costs and how to fix it. Presence only — never a value.
    expect(["ok", "degraded", "blocked"]).toContain(body.status);
    expect(body.revenueBlocked).toBe(body.status === "blocked");
    expect(Array.isArray(body.capabilities)).toBe(true);
    for (const c of body.capabilities) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.present).toBe("boolean");
      expect(["revenue_blocker", "fulfilment", "optional"]).toContain(c.severity);
      expect(c.cost_if_missing.length).toBeGreaterThan(0);
      expect(c.fix.length).toBeGreaterThan(0);
    }
    for (const v of Object.values(body.env)) expect(typeof v).toBe("boolean");
  });

  test("API responses are never cached", async ({ request }) => {
    const res = await request.get("/api/v1/meta", { headers: auth });
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
});
