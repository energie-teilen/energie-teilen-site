import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { MCP_PATH } from "../../../server/mcp-path";
import { API_V1_ENDPOINTS } from "../../../shared/api-contract";
import { indexableRoutes } from "../../../shared/routes";

/**
 * The deployment configuration is code.
 *
 * Everything else in this repository is tested against a server running on
 * this machine, where every path reaches Express. In production a rewrite
 * decides that, and a path that is not routed at the function is answered with
 * the single-page shell — a 200, with HTML, to a client expecting JSON. That
 * failure passes every local test, which is exactly why it is asserted here.
 */

// Resolved from this file, not the working directory, so the test means the
// same thing however it is invoked.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const vercel = JSON.parse(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8")) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

/** What the deployment would answer a request for this path with. */
function destinationFor(path: string): string {
  for (const rule of vercel.rewrites) {
    const re = new RegExp(`^${rule.source}$`);
    if (re.test(path)) return rule.destination;
  }
  return "(no rule)";
}

describe("vercel routing", () => {
  it("sends every v1 endpoint to the server", () => {
    for (const endpoint of API_V1_ENDPOINTS) {
      expect(destinationFor(endpoint), endpoint).toBe("/api");
    }
  });

  it("sends the MCP endpoint to the server, not the page shell", () => {
    // Without this rule /mcp returns index.html with status 200, and an MCP
    // client reports a parse error rather than a routing mistake.
    expect(destinationFor(MCP_PATH)).toBe("/api");
  });

  it("still sends application routes to the page shell", () => {
    for (const route of indexableRoutes()) {
      if (route.path.startsWith("/api")) continue;
      expect(destinationFor(route.path), route.path).toBe("/index.html");
    }
  });

  it("keeps MCP responses out of caches", () => {
    // A cached tool result is a wrong tool result the moment an input changes.
    const rule = vercel.headers.find((h) => h.source === MCP_PATH);
    expect(rule, "no header rule for /mcp").toBeDefined();
    const cacheControl = rule!.headers.find((h) => h.key === "Cache-Control")?.value ?? "";
    expect(cacheControl).toContain("no-store");
  });
});
