/**
 * server/mcp.ts
 *
 * The MCP endpoint.
 *
 * Mounts a Model Context Protocol server over Streamable HTTP at /mcp, so an
 * agent can add this address once and then call the engines as tools. Each
 * tool is a thin wrapper over the v1 route of the same name — the same code
 * path, the same validation, the same refusals — so there is no second
 * implementation to drift.
 *
 * Authentication is the same API key the REST surface uses. Anonymous access
 * would make the compute free to anyone who can spell JSON-RPC.
 */

import type { Express, Request, RequestHandler, Response } from "express";

import {
  JSON_RPC_ERRORS,
  JsonRpcRequestSchema,
  MCP_INSTRUCTIONS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  jsonRpcError,
  jsonRpcResult,
  toolByName,
  toolListPayload,
  type JsonRpcRequest,
} from "../shared/mcp.js";
import { extractApiKey, identifyApiKey } from "./api-keys.js";

import { MCP_PATH } from "./mcp-path.js";
export { MCP_PATH };

/** Everything a tool call needs to reach the engine behind it. */
export type McpDependencies = {
  /**
   * Invokes a v1 endpoint in-process. Passed in rather than fetched over HTTP:
   * a public endpoint that calls itself through the network adds a failure mode
   * and a round trip for nothing.
   */
  invoke: (
    endpoint: string,
    method: "GET" | "POST",
    payload: unknown,
  ) => Promise<{ status: number; body: unknown }>;
  limiter: RequestHandler;
};

/**
 * A tool result.
 *
 * MCP carries content as text blocks; the structured payload goes alongside so
 * a client that understands it does not have to parse prose. A refusal comes
 * back as isError with the reason intact — an agent needs to be able to tell a
 * deliberate refusal from a broken call.
 */
function toolResult(body: unknown, failed: boolean) {
  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: failed,
  };
}

export function mountMcp(app: Express, deps: McpDependencies): void {
  const requireKey: RequestHandler = (req, res, next) => {
    const identity = identifyApiKey(
      extractApiKey(req.headers as Record<string, string | string[] | undefined>),
    );
    if (!identity) {
      res.setHeader("Cache-Control", "no-store");
      // WWW-Authenticate tells a compliant client how to authenticate rather
      // than leaving it to guess from a bare 401.
      res.setHeader("WWW-Authenticate", 'Bearer realm="energie-teilen"');
      res.status(401).json(
        jsonRpcError(null, JSON_RPC_ERRORS.invalidRequest, "Ungültiger oder fehlender API-Schlüssel."),
      );
      return;
    }
    next();
  };

  async function handleRpc(rpc: JsonRpcRequest): Promise<unknown | null> {
    switch (rpc.method) {
      case "initialize":
        return jsonRpcResult(rpc.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
          instructions: MCP_INSTRUCTIONS,
        });

      // Notifications carry no id and get no response.
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return jsonRpcResult(rpc.id, {});

      case "tools/list":
        return jsonRpcResult(rpc.id, toolListPayload());

      case "tools/call": {
        const params = (rpc.params ?? {}) as { name?: string; arguments?: unknown };
        const tool = params.name ? toolByName(params.name) : null;
        if (!tool) {
          return jsonRpcError(
            rpc.id,
            JSON_RPC_ERRORS.invalidParams,
            `Unbekanntes Werkzeug "${params.name ?? ""}".`,
          );
        }

        const parsed = tool.inputSchema.safeParse(params.arguments ?? {});
        if (!parsed.success) {
          /*
           * A validation failure is a tool-level result, not a protocol error:
           * the agent should see what was wrong with its arguments and retry,
           * rather than treating the server as broken.
           */
          return jsonRpcResult(
            rpc.id,
            toolResult(
              {
                ok: false,
                code: "validation_error",
                message: "Die Eingaben entsprechen nicht dem Schema des Werkzeugs.",
                details: parsed.error.issues,
              },
              true,
            ),
          );
        }

        const { status, body } = await deps.invoke(tool.endpoint, tool.method, parsed.data);
        return jsonRpcResult(rpc.id, toolResult(body, status >= 400));
      }

      default:
        return jsonRpcError(
          rpc.id,
          JSON_RPC_ERRORS.methodNotFound,
          `Methode "${rpc.method}" wird nicht unterstützt.`,
        );
    }
  }

  app.post(MCP_PATH, deps.limiter, requireKey, async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");

    // A batch is an array; a single call is an object. Both are valid.
    const payload = req.body;
    const isBatch = Array.isArray(payload);
    const entries = isBatch ? payload : [payload];

    if (isBatch && entries.length === 0) {
      res
        .status(400)
        .json(jsonRpcError(null, JSON_RPC_ERRORS.invalidRequest, "Leerer Batch."));
      return;
    }

    const responses: unknown[] = [];
    for (const entry of entries) {
      const parsed = JsonRpcRequestSchema.safeParse(entry);
      if (!parsed.success) {
        responses.push(
          jsonRpcError(
            (entry as { id?: string | number })?.id ?? null,
            JSON_RPC_ERRORS.invalidRequest,
            "Kein gültiger JSON-RPC-2.0-Aufruf.",
          ),
        );
        continue;
      }
      try {
        const result = await handleRpc(parsed.data);
        if (result !== null) responses.push(result);
      } catch (err) {
        responses.push(
          jsonRpcError(
            parsed.data.id,
            JSON_RPC_ERRORS.internalError,
            err instanceof Error ? err.message : "Interner Fehler.",
          ),
        );
      }
    }

    // Only notifications: nothing to return, and 202 says so.
    if (responses.length === 0) {
      res.status(202).end();
      return;
    }

    res.status(200).json(isBatch ? responses : responses[0]);
  });

  /*
   * The spec allows a client to open an SSE stream for server-initiated
   * messages. This server never initiates any, so it declines the stream
   * rather than holding a connection open that will never carry anything.
   */
  app.get(MCP_PATH, requireKey, (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(405).json(
      jsonRpcError(
        null,
        JSON_RPC_ERRORS.invalidRequest,
        "Dieser Server sendet keine unaufgeforderten Nachrichten; ein SSE-Stream wird nicht angeboten.",
      ),
    );
  });
}
