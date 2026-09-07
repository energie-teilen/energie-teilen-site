/**
 * server/api-keys.ts
 *
 * API key authentication for /api/v1, without a database.
 *
 * Keys are held as SHA-256 hashes in ET_API_KEYS, one entry per client:
 *
 *   ET_API_KEYS="stadtwerke-mainz:9f2c…,epc-mueller:41ab…"
 *
 * The plaintext key is issued once and never stored: only its hash is
 * configured, so a leak of the environment does not yield working keys. The
 * label is what appears in logs and rate-limit buckets — never the key.
 *
 * Comparison is constant-time. A plain `===` on a secret leaks its prefix
 * through response timing.
 */

import { createHash, timingSafeEqual } from "crypto";

export type ApiKeyIdentity = {
  /** Human label for logs, rate limiting and per-client quotas. */
  label: string;
  /** First 8 hex chars of the key hash. Safe to log; not reversible. */
  fingerprint: string;
};

const KEY_PREFIX = "et_";
const MIN_KEY_LENGTH = 24;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Parse ET_API_KEYS into label → hash. Malformed entries are skipped loudly. */
function configuredKeys(): Map<string, string> {
  const raw = process.env.ET_API_KEYS ?? "";
  const map = new Map<string, string>();

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    const sep = trimmed.lastIndexOf(":");
    if (sep <= 0) {
      console.warn("[api-keys] skipping malformed ET_API_KEYS entry (expected label:hash)");
      continue;
    }

    const label = trimmed.slice(0, sep).trim();
    const hash = trimmed.slice(sep + 1).trim().toLowerCase();

    if (!/^[0-9a-f]{64}$/.test(hash)) {
      console.warn(`[api-keys] skipping "${label}": hash is not 64 hex characters`);
      continue;
    }
    map.set(label, hash);
  }
  return map;
}

export function apiKeysConfigured(): boolean {
  return configuredKeys().size > 0;
}

export function configuredKeyLabels(): string[] {
  return [...configuredKeys().keys()];
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) {
    // Still burn a comparison so length is not a fast-path oracle.
    if (bufB.length > 0) timingSafeEqual(bufB, bufB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Resolve a presented key to its identity, or null.
 *
 * Every configured key is compared even after a match, so the number of
 * comparisons does not reveal which entry matched.
 */
export function identifyApiKey(presented: string | undefined): ApiKeyIdentity | null {
  if (!presented || presented.length < MIN_KEY_LENGTH || !presented.startsWith(KEY_PREFIX)) {
    return null;
  }

  const presentedHash = sha256Hex(presented);
  let found: ApiKeyIdentity | null = null;

  for (const [label, hash] of configuredKeys()) {
    if (constantTimeEquals(presentedHash, hash) && found === null) {
      found = { label, fingerprint: presentedHash.slice(0, 8) };
    }
  }
  return found;
}

/** Extract the key from an Authorization header or the X-API-Key header. */
export function extractApiKey(headers: {
  authorization?: string | string[];
  "x-api-key"?: string | string[];
}): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token.length > 0) return token;
  }
  const direct = headers["x-api-key"];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  return undefined;
}

/**
 * Hash a plaintext key for configuration. Used by `pnpm apikey:hash` so a key
 * can be issued without the plaintext ever reaching the environment.
 */
export function hashApiKey(plaintext: string): string {
  return sha256Hex(plaintext);
}
