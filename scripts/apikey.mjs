#!/usr/bin/env node
/**
 * scripts/apikey.mjs — issue an API key for a /api/v1 client.
 *
 * Prints the plaintext key once (give it to the client) and the hash to add to
 * ET_API_KEYS. The plaintext is never stored anywhere, so it cannot be
 * recovered later — reissue instead.
 *
 *   pnpm apikey:new stadtwerke-mainz
 */
import { randomBytes, createHash } from "node:crypto";

const label = (process.argv[2] || "").trim();

if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(label)) {
  console.error("Usage: pnpm apikey:new <label>");
  console.error("  label: lowercase letters, digits and hyphens, e.g. stadtwerke-mainz");
  process.exit(1);
}
if (label.includes(":")) {
  console.error("Label must not contain ':' — it separates label from hash in ET_API_KEYS.");
  process.exit(1);
}

const key = `et_live_${randomBytes(24).toString("hex")}`;
const hash = createHash("sha256").update(key, "utf8").digest("hex");

console.log(`
Client label : ${label}

  Key (give this to the client, shown once):
    ${key}

  Append to ET_API_KEYS (comma-separated):
    ${label}:${hash}

  Verify:
    curl -H "Authorization: Bearer ${key}" <host>/api/v1/meta
`);
