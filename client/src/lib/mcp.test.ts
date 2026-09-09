import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  JSON_RPC_ERRORS,
  JsonRpcRequestSchema,
  MCP_INSTRUCTIONS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  jsonRpcError,
  jsonRpcResult,
  toJsonSchema,
  toolByName,
  toolListPayload,
} from "../../../shared/mcp";
import { API_V1_ENDPOINTS } from "../../../shared/api-contract";
import { API_ENDPOINTS, documentedPaths } from "../../../shared/api-reference";
import { MELO_LENGTH } from "../../../shared/market-ids";

describe("mcp server identity", () => {
  it("pins the protocol revision it was written against", () => {
    // An agent negotiates on this string. Changing it is a deliberate act, not
    // a side effect of editing something nearby.
    expect(MCP_PROTOCOL_VERSION).toBe("2025-06-18");
    expect(MCP_SERVER_INFO.name).toBe("energie-teilen");
  });

  it("tells the caller the three things that make these tools different", () => {
    // The instructions are the only place an agent learns the contract before
    // it calls anything. Each of these is a fact that changes how the tools
    // must be used, and losing one silently is the failure this guards.
    expect(MCP_INSTRUCTIONS).toContain("92");
    expect(MCP_INSTRUCTIONS).toContain("100");
    expect(MCP_INSTRUCTIONS).toMatch(/VERWEIGERN|Verweigerung/);
    expect(MCP_INSTRUCTIONS).toMatch(/rechtlich/i);
  });
});

describe("the tool set", () => {
  it("names every tool once, in snake_case", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("points every tool at an endpoint that exists", () => {
    for (const t of MCP_TOOLS) {
      expect(API_V1_ENDPOINTS as readonly string[]).toContain(t.endpoint);
    }
  });

  it("points every tool at an endpoint that is publicly documented", () => {
    // A tool an agent can call but a developer cannot read about is a trap.
    for (const t of MCP_TOOLS) expect(documentedPaths()).toContain(t.endpoint);
  });

  it("agrees with the documentation about the HTTP method", () => {
    for (const t of MCP_TOOLS) {
      const doc = API_ENDPOINTS.find((e) => e.path === t.endpoint);
      expect(doc, `no documentation for ${t.endpoint}`).toBeDefined();
      expect(doc!.method).toBe(t.method);
    }
  });

  it("covers every computation except the metadata endpoint", () => {
    // /meta describes the service; it is not a computation, so it is the one
    // documented endpoint with no tool. Everything else must be callable.
    const covered = new Set(MCP_TOOLS.map((t) => t.endpoint));
    const uncovered = API_V1_ENDPOINTS.filter((e) => !covered.has(e));
    expect(uncovered).toEqual(["/api/v1/meta"]);
  });

  it("declares every tool read-only, because none of them writes anything", () => {
    for (const t of MCP_TOOLS) expect(t.readOnly).toBe(true);
  });

  it("gives every tool a description long enough to choose it by", () => {
    // A model picks a tool from this string alone. One line is not enough to
    // convey what the tool refuses to do.
    for (const t of MCP_TOOLS) expect(t.description.length).toBeGreaterThan(180);
  });
});

describe("toJsonSchema", () => {
  it("emits an object schema with the required keys marked", () => {
    const schema = toJsonSchema(
      z.object({ a: z.string().min(1), b: z.number().int().optional() }),
    );
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["a"]);
    expect((schema.properties as Record<string, { type: string }>).a.type).toBe("string");
  });

  it("drops the dialect marker, which MCP carries itself", () => {
    expect(toJsonSchema(z.object({ a: z.string() })).$schema).toBeUndefined();
  });

  it("refuses a schema that is not an object", () => {
    // MCP tool arguments are always named. A tool whose schema said otherwise
    // would be listed and then fail on every call.
    expect(() => toJsonSchema(z.string())).toThrow(/must be an object/);
  });

  it("converts every tool schema to a usable object schema", () => {
    for (const t of MCP_TOOLS) {
      const schema = toJsonSchema(t.inputSchema);
      expect(schema.type, t.name).toBe("object");
      expect(Object.keys(schema.properties as object).length, t.name).toBeGreaterThan(0);
    }
  });

  it("carries the constraints the validator actually enforces", () => {
    // The published schema and the runtime check must be the same statement.
    // A date pattern in the schema is how an agent avoids a round trip.
    const grid = toolByName("market_grid")!;
    const props = toJsonSchema(grid.inputSchema).properties as Record<string, { pattern?: string }>;
    expect(props.date.pattern).toBeDefined();
    expect(new RegExp(props.date.pattern!).test("2026-10-25")).toBe(true);
    expect(new RegExp(props.date.pattern!).test("25.10.2026")).toBe(false);
  });
});

describe("toolListPayload", () => {
  it("annotates every tool as read-only, idempotent and closed-world", () => {
    for (const t of toolListPayload().tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.idempotentHint).toBe(true);
      // Nothing here reaches out to the open web; results depend only on input.
      expect(t.annotations.openWorldHint).toBe(false);
    }
  });

  it("lists exactly the declared tools", () => {
    expect(toolListPayload().tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
  });
});

describe("toolByName", () => {
  it("returns null rather than a near match", () => {
    expect(toolByName("market_grid")?.name).toBe("market_grid");
    expect(toolByName("market_gri")).toBeNull();
    expect(toolByName("")).toBeNull();
  });
});

describe("json-rpc envelope", () => {
  it("accepts a call, a notification and a batch member", () => {
    expect(JsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: 1, method: "ping" }).success).toBe(true);
    expect(JsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", method: "notifications/initialized" }).success).toBe(true);
    expect(JsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: "a", method: "tools/list" }).success).toBe(true);
  });

  it("rejects an envelope from another protocol version", () => {
    expect(JsonRpcRequestSchema.safeParse({ jsonrpc: "1.0", id: 1, method: "ping" }).success).toBe(false);
    expect(JsonRpcRequestSchema.safeParse({ id: 1, method: "ping" }).success).toBe(false);
  });

  it("carries a null id when a request could not be identified", () => {
    // JSON-RPC requires an id on the error even when the request had none.
    expect(jsonRpcError(undefined, JSON_RPC_ERRORS.parseError, "kaputt").id).toBeNull();
    expect(jsonRpcResult(7, { ok: true })).toMatchObject({ jsonrpc: "2.0", id: 7 });
  });

  it("uses the reserved code range", () => {
    for (const code of Object.values(JSON_RPC_ERRORS)) {
      expect(code).toBeLessThanOrEqual(-32000);
      expect(code).toBeGreaterThanOrEqual(-32700);
    }
  });
});

describe("the documented examples are the examples that work", () => {
  it("uses a Messlokations-ID the engine accepts", () => {
    // A developer copies the example first. If the example is refused, the
    // first thing they learn about the API is that it does not work.
    for (const e of API_ENDPOINTS) {
      for (const melo of e.example.match(/DE[0-9A-Z]{10,40}/g) ?? []) {
        expect(melo.length, `${e.path} documents a ${melo.length}-character MeLo`).toBe(MELO_LENGTH);
      }
    }
  });
});
