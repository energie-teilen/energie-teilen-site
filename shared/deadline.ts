/**
 * shared/deadline.ts
 *
 * Time budgeting for work inside a serverless invocation.
 *
 * vercel.json caps the API function at a fixed duration. The Stripe webhook
 * performs several network round-trips (KV claim, ledger read, ledger write,
 * two emails, ledger write) and must finish inside that ceiling; an endpoint
 * that repeatedly times out is disabled by Stripe.
 *
 * Responding 200 before doing the work is not an option here: the platform may
 * freeze or reclaim the container once the response is flushed, so work started
 * after it may never run.
 *
 * The work therefore stays in the request and is bounded. If the budget is
 * exhausted the request is acknowledged and the ledger stays in a stage whose
 * derived next action states what remains.
 */

/** Wall-clock ceiling from vercel.json, in ms. */
export const FUNCTION_LIMIT_MS = 60_000;

/**
 * Share of the ceiling the fulfillment work may consume. The remainder is
 * headroom for response serialisation and platform overhead.
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
 * The underlying promise is not cancelled (JS cannot cancel an in-flight
 * fetch), so its later rejection is swallowed to avoid an unhandled rejection.
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
 * Stripe sets `name` to the generic "Error"; the discriminator is `type`, with
 * the constructor name as a fallback for bundlers that rewrite it.
 */
export function isSignatureVerificationError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { type?: unknown; constructor?: { name?: string } };
  return (
    e.type === "StripeSignatureVerificationError" ||
    e.constructor?.name === "StripeSignatureVerificationError"
  );
}
