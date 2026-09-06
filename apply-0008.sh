set -euo pipefail
cd /workspaces/energie-teilen-site

echo "==> writing shared/deadline.ts"
cat > shared/deadline.ts <<'DEADLINE_TS'
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
DEADLINE_TS

echo "==> writing client/src/lib/deadline.test.ts"
cat > client/src/lib/deadline.test.ts <<'DEADLINE_TEST'
import { describe, it, expect, vi } from "vitest";
import {
  Deadline,
  DeadlineExceededError,
  FULFILLMENT_BUDGET_MS,
  FUNCTION_LIMIT_MS,
  STEP_TIMEOUT_MS,
  isSignatureVerificationError,
  withDeadline,
  withDeadlineOr,
} from "../../../shared/deadline";

/**
 * These guard the Stripe webhook against the failure mode that gets an
 * endpoint disabled: repeated timeouts. The budget must leave headroom, a
 * single hung dependency must not eat it, and a slow operator notification
 * must never cost a customer their confirmation.
 */

describe("budget shape", () => {
  it("leaves headroom below the platform ceiling", () => {
    expect(FULFILLMENT_BUDGET_MS).toBeLessThan(FUNCTION_LIMIT_MS);
    // Being killed at 100% of the ceiling is exactly what this prevents.
    expect(FUNCTION_LIMIT_MS - FULFILLMENT_BUDGET_MS).toBeGreaterThan(5_000);
  });

  it("keeps any single step well inside the whole budget", () => {
    expect(STEP_TIMEOUT_MS).toBeLessThan(FULFILLMENT_BUDGET_MS / 2);
  });

  it("matches the ceiling declared in vercel.json", () => {
    // If someone lowers maxDuration without lowering this, the guard is a lie.
    expect(FUNCTION_LIMIT_MS).toBe(60_000);
  });
});

describe("Deadline", () => {
  function clock(start = 1_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it("reports remaining time against an injected clock", () => {
    const c = clock();
    const d = new Deadline(10_000, c.now);
    expect(d.remaining()).toBe(10_000);
    c.advance(3_000);
    expect(d.elapsed()).toBe(3_000);
    expect(d.remaining()).toBe(7_000);
  });

  it("never reports negative time remaining", () => {
    const c = clock();
    const d = new Deadline(1_000, c.now);
    c.advance(9_999);
    expect(d.remaining()).toBe(0);
    expect(d.expired()).toBe(true);
  });

  // Checked BEFORE a step, which is the only point at which stopping is clean.
  it("answers whether another step of a given size fits", () => {
    const c = clock();
    const d = new Deadline(10_000, c.now);
    expect(d.hasRoomFor(8_000)).toBe(true);
    c.advance(5_000);
    expect(d.hasRoomFor(8_000)).toBe(false);
    expect(d.hasRoomFor(1_000)).toBe(true);
  });
});

describe("withDeadline", () => {
  it("passes through a value that arrives in time", async () => {
    await expect(withDeadline(Promise.resolve("ok"), 50, "fast")).resolves.toBe("ok");
  });

  it("rejects with a labelled error when the step hangs", async () => {
    const hung = new Promise<string>(() => undefined);
    await expect(withDeadline(hung, 10, "kv-write")).rejects.toBeInstanceOf(
      DeadlineExceededError,
    );
    await expect(withDeadline(hung, 10, "kv-write")).rejects.toThrow("kv-write");
  });

  it("propagates a genuine rejection rather than masking it as a timeout", async () => {
    await expect(
      withDeadline(Promise.reject(new Error("network down")), 50, "mail"),
    ).rejects.toThrow("network down");
  });

  // A losing promise that rejects later must not take the process down after
  // we have already moved on.
  it("does not produce an unhandled rejection from the loser", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const slowFailure = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("late failure")), 20),
    );
    await expect(withDeadline(slowFailure, 5, "slow")).rejects.toBeInstanceOf(
      DeadlineExceededError,
    );
    await new Promise((r) => setTimeout(r, 40));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("withDeadlineOr", () => {
  it("returns the value when the step completes", async () => {
    await expect(withDeadlineOr(Promise.resolve(true), 50, "mail", false)).resolves.toBe(
      true,
    );
  });

  it("falls back instead of throwing when the step hangs", async () => {
    const hung = new Promise<boolean>(() => undefined);
    await expect(withDeadlineOr(hung, 10, "operator-mail", false)).resolves.toBe(false);
  });

  it("falls back when the step rejects, so one failure cannot cascade", async () => {
    await expect(
      withDeadlineOr(Promise.reject(new Error("resend 500")), 50, "operator-mail", false),
    ).resolves.toBe(false);
  });
});

describe("isSignatureVerificationError", () => {
  // Stripe sets `name` to the generic "Error"; the discriminator is `type`.
  // Checking `name` typechecked fine and silently returned 500 for a forged
  // signature — telling Stripe to retry something that can never succeed.
  it("recognises the real Stripe error shape", () => {
    const real = Object.assign(new Error("No signatures found"), {
      type: "StripeSignatureVerificationError",
    });
    expect(real.name).toBe("Error"); // the trap
    expect(isSignatureVerificationError(real)).toBe(true);
  });

  it("recognises it by constructor name too", () => {
    class StripeSignatureVerificationError extends Error {}
    expect(isSignatureVerificationError(new StripeSignatureVerificationError("x"))).toBe(true);
  });

  it("does not misclassify an unrelated failure as a bad signature", () => {
    expect(isSignatureVerificationError(new Error("network down"))).toBe(false);
    expect(isSignatureVerificationError({ type: "StripeAPIError" })).toBe(false);
    expect(isSignatureVerificationError(null)).toBe(false);
    expect(isSignatureVerificationError("boom")).toBe(false);
  });
});
DEADLINE_TEST

echo "==> raising the function ceiling in vercel.json"
sed -i 's/"maxDuration": 15/"maxDuration": 60/' vercel.json
grep -q '"maxDuration": 60' vercel.json || { echo "FAILED: vercel.json not updated"; exit 1; }

echo "==> patching server/index.ts"
cat > /tmp/patch08.py <<'PATCH_PY'
import io, sys, re
p = "server/index.ts"
s = io.open(p, encoding="utf-8").read()
def rep(old, new, label):
    global s
    if old not in s:
        sys.exit("ANCHOR NOT FOUND: " + label)
    s = s.replace(old, new, 1)

rep('import { getKv } from "./kv.js";',
'''import { getKv } from "./kv.js";
import {
  Deadline,
  STEP_TIMEOUT_MS,
  isSignatureVerificationError,
  withDeadlineOr,
} from "../shared/deadline.js";''', "imports")

rep('''      try {
        const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);

        // Idempotency: process each Stripe event id at most once (when KV present).
        const kv = await getKv();
        if (kv) {
          const fresh = await kv.set(`stripe:evt:${event.id}`, "1", {
            nx: true,
            ex: 60 * 60 * 24 * 7,
          });
          if (fresh === null) {
            // Already handled — acknowledge without re-running side effects.
            return res.status(200).send("ok");
          }
        }
''',
'''      // Hoisted so the catch block can release the claim it may have taken.
      let eventId: string | undefined;

      try {
        const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
        eventId = event.id;

        // Idempotency, done as a CLAIM rather than a tombstone.
        //
        // The previous version wrote a 7-day "handled" marker BEFORE doing any
        // work. If the invocation then timed out or threw, Stripe's retry hit
        // that marker and was skipped, so a confirmation could be lost with no
        // trace anywhere. That is a silent failure on a paid order.
        //
        // Now: claim for 5 minutes (long enough that concurrent deliveries of
        // the same event cannot both run), extend to 7 days only after the work
        // succeeds, and RELEASE the claim on failure so the retry can redo it.
        const kv = await getKv();
        const claimKey = `stripe:evt:${event.id}`;
        const CLAIM_TTL_S = 300;
        const DONE_TTL_S = 60 * 60 * 24 * 7;

        if (kv) {
          const claimed = await kv.set(claimKey, "claimed", { nx: true, ex: CLAIM_TTL_S });
          if (claimed === null) {
            // Already claimed or already done: acknowledge, run nothing.
            return res.status(200).send("ok");
          }
        }

        const completeClaim = async () => {
          if (!kv) return;
          try {
            await kv.set(claimKey, "done", { ex: DONE_TTL_S });
          } catch (err) {
            console.error(`[stripe] could not finalise claim ${claimKey}`, err);
          }
        };

        // Bound the work so the platform never kills us mid-flight. See
        // shared/deadline.ts for why "respond first, work after" is wrong here.
        const deadline = new Deadline();
''', "idempotency claim")

rep('''          await sendNotificationEmail(
            `[Energie Teilen] 💰 Bezahlt: ${order.reference} · ${md.offerLabel || md.offerCode}`,
            html,
          );

          // ── FULFILLMENT: confirm to the CUSTOMER.
          // Guarded per session (not per event) so `completed` followed by
          // `async_payment_succeeded` on a SEPA debit cannot mail twice.
          if (order.status === "paid" && order.email) {
            let alreadySent = false;
            const kvForMail = await getKv();
            if (kvForMail) {
              const fresh = await kvForMail.set(`order:confirmed:${session.id}`, "1", {
                nx: true,
                ex: 60 * 60 * 24 * 30,
              });
              alreadySent = fresh === null;
            }
            if (!alreadySent) {
              const replyTo =
                process.env.ET_CUSTOMER_REPLY_TO ||
                process.env.LEAD_NOTIFICATION_EMAIL ||
                "kontakt@energie-teilen.de";
              const sent = await sendEmail(
                order.email,
                `Energie Teilen · Bestätigung ${order.reference} — ${order.offerLabel}`,
                buildCustomerConfirmationHtml(order, replyTo),
              );
              if (!sent) {''',
'''          // The two mails are independent. Sending them sequentially spent two
          // full round-trips of the budget for no reason.
          //
          // Per-session guard (not per-event) so `completed` followed by
          // `async_payment_succeeded` on a SEPA debit cannot mail twice.
          let alreadySent = false;
          const shouldConfirm = order.status === "paid" && Boolean(order.email);
          if (shouldConfirm && kv) {
            const fresh = await withDeadlineOr(
              kv.set(`order:confirmed:${session.id}`, "1", { nx: true, ex: 60 * 60 * 24 * 30 }),
              STEP_TIMEOUT_MS,
              "confirm-guard",
              null,
            );
            alreadySent = fresh === null;
          }

          const replyTo =
            process.env.ET_CUSTOMER_REPLY_TO ||
            process.env.LEAD_NOTIFICATION_EMAIL ||
            "kontakt@energie-teilen.de";

          const [, customerSent] = await Promise.all([
            // Operator notification is nice-to-have: a slow inbox must never
            // cost a customer their confirmation.
            withDeadlineOr(
              sendNotificationEmail(
                `[Energie Teilen] 💰 Bezahlt: ${order.reference} · ${md.offerLabel || md.offerCode}`,
                html,
              ),
              STEP_TIMEOUT_MS,
              "operator-mail",
              undefined,
            ),
            shouldConfirm && !alreadySent
              ? withDeadlineOr(
                  sendEmail(
                    order.email as string,
                    `Energie Teilen · Bestätigung ${order.reference} — ${order.offerLabel}`,
                    buildCustomerConfirmationHtml(order, replyTo),
                  ),
                  STEP_TIMEOUT_MS,
                  "customer-mail",
                  false,
                )
              : Promise.resolve(alreadySent),
          ]);

          if (shouldConfirm) {
            {
              const sent = customerSent;
              if (!sent) {''', "parallel mails")

rep('''                   <p><strong>E-Mail:</strong> ${escapeHtml(order.email)}</p>''',
'''                   <p><strong>E-Mail:</strong> ${escapeHtml(order.email ?? "—")}</p>''', "email null guard")

rep('''              } else {
                // Confirmation delivered — the ball is now in the customer's
                // court, and the ledger says so without anyone updating it.
                const moved = advanceStage(current, "awaiting_data", "stripe:webhook", {''',
'''              } else if (!alreadySent) {
                // Confirmation delivered: the ball is now in the customer's
                // court, and the ledger says so without anyone updating it.
                // If we never get here the order stays at "paid", whose derived
                // next action already reads "Bestaetigung versenden". A timeout
                // becomes visible work rather than a silent gap.
                const moved = advanceStage(current, "awaiting_data", "stripe:webhook", {''', "stage advance guard")

rep('''            }
          }
        }

        return res.status(200).send("ok");
      } catch (err) {
        console.error("[stripe] webhook verification failed", err);
        return res.status(400).send("invalid signature");
      }''',
'''            }
          }

          if (deadline.expired()) {
            console.warn(
              `[stripe] fulfillment for ${order.reference} used the full budget (${deadline.elapsed()}ms)`,
            );
          }
        }

        await completeClaim();
        return res.status(200).send("ok");
      } catch (err) {
        // Signature failures are the caller's problem: 400, and no claim was
        // taken because we never got past constructEvent.
        if (isSignatureVerificationError(err)) {
          console.error("[stripe] webhook signature verification failed", err);
          return res.status(400).send("invalid signature");
        }

        // Anything else means the work did NOT complete. Release the claim so
        // Stripe's retry runs it again, and return 500 so Stripe knows to retry
        // rather than recording a success we did not achieve.
        console.error("[stripe] webhook processing failed", err);
        try {
          const kvForRelease = await getKv();
          if (kvForRelease) await kvForRelease.del(`stripe:evt:${eventId ?? "unknown"}`);
        } catch (releaseErr) {
          console.error("[stripe] claim release failed", releaseErr);
        }
        return res.status(500).send("processing failed");
      }''', "catch block")

io.open(p, "w", encoding="utf-8").write(s)
print("server/index.ts patched")
PATCH_PY
python3 /tmp/patch08.py

echo
echo "==> all edits applied"
