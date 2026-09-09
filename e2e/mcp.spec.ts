import { test, expect, type APIRequestContext } from "@playwright/test";
import { E2E_API_KEY } from "./fixtures";

/**
 * The MCP endpoint, exercised as an agent would exercise it.
 *
 * These tests are the reason an agent can be told to trust the tools: the
 * protocol behaves, the schemas are honest, a refusal comes back as a refusal
 * rather than a plausible number, and the answer over MCP is byte-for-byte the
 * answer over HTTP.
 */

const auth = { Authorization: `Bearer ${E2E_API_KEY}` };
const MELO = "DE000000000000000000000000012345A";

type RpcOptions = { headers?: Record<string, string> };

async function rpc(request: APIRequestContext, body: unknown, options: RpcOptions = {}) {
  return request.post("/mcp", {
    headers: { "content-type": "application/json", ...auth, ...(options.headers ?? {}) },
    data: body,
  });
}

async function call(request: APIRequestContext, name: string, args: unknown) {
  const res = await rpc(request, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).result;
}

test.describe("transport and authentication", () => {
  test("refuses an unauthenticated call and says how to authenticate", async ({ request }) => {
    const res = await request.post("/mcp", {
      headers: { "content-type": "application/json" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(res.status()).toBe(401);
    // Without this header an MCP client cannot tell an auth failure from an
    // outage, and retries instead of asking for a key.
    expect(res.headers()["www-authenticate"]).toBeTruthy();
  });

  test("declines the server-initiated stream rather than leaving it open", async ({ request }) => {
    // This server never pushes; a GET that hung would cost the client a
    // connection for nothing.
    const res = await request.get("/mcp", { headers: auth });
    expect(res.status()).toBe(405);
  });

  test("answers a notification with 202 and no body", async ({ request }) => {
    const res = await rpc(request, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status()).toBe(202);
    expect((await res.body()).length).toBe(0);
  });

  test("answers a batch in one response, preserving ids", async ({ request }) => {
    const res = await rpc(request, [
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", id: "b", method: "tools/list" },
    ]);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((m: { id: string }) => m.id)).toEqual(["a", "b"]);
  });

  test("names an unsupported method instead of failing silently", async ({ request }) => {
    const body = await (await rpc(request, { jsonrpc: "2.0", id: 1, method: "resources/list" })).json();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("resources/list");
  });

  test("rejects a malformed envelope", async ({ request }) => {
    const body = await (await rpc(request, { id: 1, method: "ping" })).json();
    expect(body.error).toBeTruthy();
  });
});

test.describe("initialize", () => {
  test("returns the protocol version, the tool capability and the usage contract", async ({ request }) => {
    const res = await rpc(request, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
    });
    expect(res.status()).toBe(200);
    const { result } = await res.json();
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities.tools).toBeTruthy();
    expect(result.serverInfo.name).toBe("energie-teilen");
    // The instructions are where an agent learns that a refusal is a result.
    expect(result.instructions).toMatch(/VERWEIGERN|Verweigerung/);
    expect(result.instructions).toContain("100");
  });
});

test.describe("tools/list", () => {
  test("publishes a callable schema for every tool", async ({ request }) => {
    const { result } = await (await rpc(request, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    expect(result.tools.length).toBeGreaterThanOrEqual(8);
    for (const tool of result.tools) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(Object.keys(tool.inputSchema.properties ?? {}).length, tool.name).toBeGreaterThan(0);
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
    }
  });

  test("matches the tool list published at /.well-known/mcp.json", async ({ request }) => {
    // An agent that reads the manifest and an agent that connects must be
    // offered the same tools, or one of them is calling something that is not
    // there.
    const live = (await (await rpc(request, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json()).result.tools;
    const manifest = await (await request.get("/.well-known/mcp.json")).json();
    expect(manifest.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      live.map((t: { name: string }) => t.name).sort(),
    );
    for (const t of manifest.tools) {
      const match = live.find((l: { name: string }) => l.name === t.name);
      expect(JSON.stringify(t.inputSchema), t.name).toBe(JSON.stringify(match.inputSchema));
    }
  });
});

test.describe("tools/call", () => {
  test("returns the real interval count on the long day", async ({ request }) => {
    // The last Sunday in October has 100 quarter-hours. A tool that answered
    // 96 here would be wrong in a way no downstream check would catch.
    const result = await call(request, "market_grid", { date: "2026-10-25" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.intervals).toBe(100);
    // The same content is repeated as text, for clients that read only that.
    expect(JSON.parse(result.content[0].text).intervals).toBe(100);
  });

  test("returns 92 on the short day and 96 on an ordinary one", async ({ request }) => {
    expect((await call(request, "market_grid", { date: "2026-03-29" })).structuredContent.intervals).toBe(92);
    expect((await call(request, "market_grid", { date: "2026-06-15" })).structuredContent.intervals).toBe(96);
  });

  test("refuses a series that does not fit the grid, and says why", async ({ request }) => {
    const result = await call(request, "build_mscons_message", {
      period: { date: "2026-10-25" },
      sender: { code: "9999999999994" },
      receiver: { code: "8888888888888" },
      locations: [
        { melo: MELO, direction: "consumption", valuesKwh: Array.from({ length: 96 }, () => 1) },
      ],
    });
    // A refusal is a tool result, not a protocol error: the agent must be able
    // to read the reason and correct its input.
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("unsupported_input");
    expect(result.structuredContent.message).toContain("100");
  });

  test("refuses input that does not match the published schema", async ({ request }) => {
    const result = await call(request, "market_grid", { date: "25.10.2026" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("validation_error");
  });

  test("names an unknown tool rather than guessing", async ({ request }) => {
    const body = await (
      await rpc(request, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "calculate_everything", arguments: {} },
      })
    ).json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("calculate_everything");
  });

  test("does not assume a metering concept it was not given the data for", async ({ request }) => {
    const result = await call(request, "derive_metering_concept", {
      constellation: { units: 24, kwp: 60 },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.variant).toBe("not_determinable");
  });
});

test.describe("MCP and HTTP are one implementation", () => {
  const CASES: { tool: string; method: "get" | "post"; path: string; args: Record<string, unknown> }[] = [
    {
      tool: "calculate_economics",
      method: "post",
      path: "/api/v1/calculate",
      args: { inputs: { kwp: 60, anzahlWohneinheiten: 24 }, includeSchedule: true },
    },
    {
      tool: "assess_eligibility",
      method: "post",
      path: "/api/v1/eligibility",
      args: { inputs: { kwp: 60 }, facts: { ownerConstellation: "weg" } },
    },
    {
      tool: "derive_metering_concept",
      method: "post",
      path: "/api/v1/messkonzept",
      args: { constellation: { units: 24, kwp: 60, gridConnection: "single_connection" } },
    },
    {
      tool: "allocate_generation",
      method: "post",
      path: "/api/v1/allocation",
      args: {
        generationKwh: [0, 4, 10, 2],
        participants: [
          { id: "a", share: 0.5, consumptionKwh: [1, 1, 1, 1] },
          { id: "b", share: 0.5, consumptionKwh: [1, 5, 5, 1] },
        ],
      },
    },
    {
      tool: "bill_period",
      method: "post",
      path: "/api/v1/billing",
      args: {
        period: { from: "2026-01-01", to: "2027-01-01" },
        tariff: { mieterstromCtPerKwh: 28, reststromCtPerKwh: 34, grundpreisEurPerYear: 120 },
        participants: [{ id: "we-1", allocatedKwh: 1200, gridDrawKwh: 1800 }],
      },
    },
    { tool: "market_grid", method: "get", path: "/api/v1/mako/grid?date=2026-10-25", args: { date: "2026-10-25" } },
    {
      tool: "validate_market_identifiers",
      method: "post",
      path: "/api/v1/mako/identifiers",
      args: { senderCode: "9999999999994", receiverCode: "8888888888888" },
    },
    {
      tool: "build_mscons_message",
      method: "post",
      path: "/api/v1/mako/mscons",
      args: {
        period: { date: "2026-10-25" },
        sender: { code: "9999999999994" },
        receiver: { code: "8888888888888" },
        locations: [
          {
            melo: MELO,
            direction: "consumption",
            valuesKwh: Array.from({ length: 100 }, (_, i) => i / 10),
          },
        ],
      },
    },
  ];

  // Anything that legitimately differs between two calls a millisecond apart.
  const VOLATILE =
    /"(calculatedAt|generatedAt|timestamp|requestId|controlReference|messageReference|preparedAt)":"[^"]*"/g;

  function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, stable(o[k])]));
    }
    return value;
  }
  const normalise = (v: unknown) => JSON.stringify(stable(v)).replace(VOLATILE, '"$1":"<volatile>"');

  for (const c of CASES) {
    test(`${c.tool} answers identically over both surfaces`, async ({ request }) => {
      const http =
        c.method === "get"
          ? await request.get(c.path, { headers: auth })
          : await request.post(c.path, { headers: auth, data: c.args });
      const overMcp = await call(request, c.tool, c.args);

      expect(await http.json().then((b) => b.ok)).toBe(true);
      expect(overMcp.isError).toBeFalsy();
      // Not "similar": the same bytes. The two surfaces share one function, and
      // this is what proves it stayed that way.
      expect(normalise(overMcp.structuredContent)).toBe(normalise(await http.json()));
    });
  }
});
