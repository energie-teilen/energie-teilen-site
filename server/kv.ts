/**
 * server/kv.ts
 *
 * The durable store, extracted from server/index.ts so the ledger can use it
 * without importing the whole Express app.
 *
 * Upstash Redis over REST. Absent config is a supported state: the server still
 * runs, and callers are expected to surface the absence rather than dropping
 * data without a signal.
 */

let kvPromise: Promise<any | null> | null = null;

export async function getKv(): Promise<any | null> {
  if (!kvPromise) {
    kvPromise = (async () => {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) return null;
      try {
        const mod = await import("@upstash/redis");
        return new mod.Redis({ url, token });
      } catch (err) {
        console.warn(
          "[kv] UPSTASH env set but @upstash/redis not installed. Run: pnpm add @upstash/redis",
          err,
        );
        return null;
      }
    })();
  }
  return kvPromise;
}

export function isKvConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

/** Test seam. */
export function resetKvForTests(): void {
  kvPromise = null;
}
