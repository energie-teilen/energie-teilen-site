// api/index.ts
//
// Vercel serverless function entry. Wraps the Express app from server/index.ts
// and survives every kind of failure with a useful error response.
//
// If anything goes wrong (import error, buildApp throw, request crash) you get
// a JSON 500 with the actual exception message + name + stack — never the
// opaque FUNCTION_INVOCATION_FAILED page.

import type { IncomingMessage, ServerResponse } from "http";

// Cached across warm invocations
let appPromise: Promise<any> | null = null;
let buildError: Error | null = null;

async function getApp(): Promise<any> {
  if (buildError) throw buildError;
  if (!appPromise) {
    appPromise = (async () => {
      try {
        // Dynamic import so import-time errors are caught here, not at boot
        const mod = await import("../server/index");
        if (typeof mod.buildApp !== "function") {
          throw new Error(
            "server/index.ts does not export `buildApp`. Check the export.",
          );
        }
        return await mod.buildApp();
      } catch (err) {
        buildError = err instanceof Error ? err : new Error(String(err));
        // eslint-disable-next-line no-console
        console.error("[api] buildApp() failed:", buildError);
        throw buildError;
      }
    })();
  }
  return appPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // eslint-disable-next-line no-console
    console.error("[api] handler error:", error);

    // Always log full details to Vercel; only return safe info to the client.
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    const body = {
      ok: false,
      error: "server_error",
      // The next two ARE shown so you can debug. Once stable, gate them
      // behind a header like x-debug-token if you don't want them public.
      name: error.name,
      message: error.message,
      // Stack trace only when DEBUG flag is set, to avoid leaking paths.
      stack: process.env.DEBUG ? error.stack : undefined,
    };
    res.end(JSON.stringify(body, null, 2));
  }
}
