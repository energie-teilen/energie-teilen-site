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
