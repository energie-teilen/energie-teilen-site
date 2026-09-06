/**
 * shared/deadline.ts
 *
 * Time budgeting for work that runs inside a serverless invocation.
 *
 * vercel.json caps the API function at a fixed duration. The Stripe webhook now
 * does several network round-trips — KV claim, ledger read, ledger write,
 * operator email, customer email, ledger write — on a cold Frankfurt lambda.
 * When that exceeds the ceiling the platform kills the invocation mid-flight:
 * Stripe sees a timeout, retries, and an endpoint that times out repeatedly is
 * eventually DISABLED by Stripe. Silently. You find out when a customer says
 * the confirmation never arrived.
 *
 * The tempting fix — respond 200 first, then do the work — is wrong on this
 * architecture. Lambda may freeze or reclaim the container the instant the
 * response is flushed, so work started after the response may never run at all.
 * That trades a loud failure for a silent one.
 *
 * So instead: keep the work in the request, but BOUND it. If the budget runs
 * out, acknowledge Stripe (so it stops retrying into a wall) and leave the
 * ledger in a stage whose derived next action already says what still has to
 * happen. Nothing is lost; it just becomes visible work instead of invisible
 * failure.
 */

/** Wall-clock ceiling from vercel.json, in ms. */
export const FUNCTION_LIMIT_MS = 60_000;

/**
 * How much of the ceiling the fulfillment work may consume. The remainder is
 * headroom for response serialisation and platform overhead — being killed at
 * 100% of the budget is exactly what this exists to prevent.
 */
export const FULFILLMENT_BUDGET_MS = Math.floor(FUNCTION_LIMIT_MS * 0.7);

/** Per-step ceiling, so one hung dependency cannot consume the whole budget. */
export const STEP_TIMEOUT_MS = 8_000;

export class DeadlineExceededError extends Error {
  constructor(label: string) {
    super(`Deadline exceeded: ${label}`);
    this.name = "DeadlineExceededError";
  }
}

/**
 * A monotonic budget. Constructed once per invocation and consulted between
 * steps rather than mid-step, so a step is never abandoned halfway.
 */
export class Deadline {
  private readonly startedAt: number;

  constructor(
    private readonly budgetMs: number = FULFILLMENT_BUDGET_MS,
    now: () => number = Date.now,
  ) {
    this.now = now;
    this.startedAt = now();
  }

  private readonly now: () => number;

  elapsed(): number {
    return this.now() - this.startedAt;
  }

  remaining(): number {
    return Math.max(0, this.budgetMs - this.elapsed());
  }

  expired(): boolean {
    return this.remaining() <= 0;
  }

  /**
   * Is there room for another step of roughly this size?
   *
   * Checked BEFORE starting a step, which is the only point at which stopping
   * is clean.
   */
  hasRoomFor(stepMs: number): boolean {
    return this.remaining() > stepMs;
  }
}

/**
 * Run a promise with a ceiling. Rejects with DeadlineExceededError if it does
 * not settle in time.
 *
 * The underlying promise is NOT cancelled — nothing in JS can cancel a fetch
 * already in flight from the outside — so its rejection is swallowed to avoid
 * an unhandled rejection crashing the process after we have moved on.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(label)), ms);
  });

  promise.catch(() => undefined); // never let the loser reject unhandled

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run a promise with a ceiling and fall back to a value instead of throwing.
 * For steps that are nice-to-have: a slow operator notification must not cost
 * a customer their confirmation.
 */
export async function withDeadlineOr<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  fallback: T,
): Promise<T> {
  try {
    return await withDeadline(promise, ms, label);
  } catch {
    return fallback;
  }
}

/**
 * Is this a Stripe webhook signature failure?
 *
 * Stripe's error objects set `name` to the generic "Error" — the real
 * discriminator is `type` (with the constructor name as a fallback for
 * bundlers that rewrite it). Checking `name` looked right, passed typecheck,
 * and quietly returned 500 for a forged signature: telling Stripe to retry a
 * request that can never succeed, and releasing the idempotency claim while
 * doing so. Caught by firing a forged signature at a running server.
 */
export function isSignatureVerificationError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { type?: unknown; constructor?: { name?: string } };
  return (
    e.type === "StripeSignatureVerificationError" ||
    e.constructor?.name === "StripeSignatureVerificationError"
  );
}
