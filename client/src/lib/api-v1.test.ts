import { describe, it, expect } from "vitest";
import {
  API_PREFIX,
  API_VERSION,
  CalculateRequestSchema,
  CalculateResponseSchema,
  EligibilityRequestSchema,
  EligibilityResponseSchema,
  MetaResponseSchema,
  ApiV1ErrorSchema,
} from "../../../shared/api-contract";
import {
  extractApiKey,
  hashApiKey,
  identifyApiKey,
} from "../../../server/api-keys";

describe("api contract", () => {
  it("pins the version and prefix so v1 clients keep working", () => {
    expect(API_VERSION).toBe("1.0.0");
    expect(API_PREFIX).toBe("/api/v1");
  });

  it("requires kwp, since every regulated rate is banded by plant size", () => {
    expect(CalculateRequestSchema.safeParse({ inputs: {} }).success).toBe(false);
    expect(CalculateRequestSchema.safeParse({ inputs: { kwp: 30 } }).success).toBe(true);
  });

  it("accepts a partial input set and defaults the rest", () => {
    const r = CalculateRequestSchema.safeParse({
      inputs: { kwp: 88, eigenverbrauchsquote: 0.52 },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.includeSchedule).toBe(false);
  });

  it("rejects an implausible plant size rather than computing it", () => {
    expect(CalculateRequestSchema.safeParse({ inputs: { kwp: 0 } }).success).toBe(false);
    expect(CalculateRequestSchema.safeParse({ inputs: { kwp: -5 } }).success).toBe(false);
    expect(CalculateRequestSchema.safeParse({ inputs: { kwp: 99999 } }).success).toBe(false);
  });

  it("carries the model stamp on every successful response", () => {
    for (const schema of [CalculateResponseSchema, EligibilityResponseSchema, MetaResponseSchema]) {
      expect(schema.shape.model).toBeDefined();
    }
  });

  it("keeps eligibility responses carrying their disclaimer", () => {
    expect(EligibilityResponseSchema.shape.disclaimer).toBeDefined();
  });

  it("accepts qualification facts as optional", () => {
    expect(EligibilityRequestSchema.safeParse({ inputs: { kwp: 30 } }).success).toBe(true);
    expect(
      EligibilityRequestSchema.safeParse({
        inputs: { kwp: 30 },
        facts: { ownerConstellation: "weg" },
      }).success,
    ).toBe(true);
    expect(
      EligibilityRequestSchema.safeParse({
        inputs: { kwp: 30 },
        facts: { ownerConstellation: "nonsense" },
      }).success,
    ).toBe(false);
  });

  it("uses a typed error envelope", () => {
    expect(
      ApiV1ErrorSchema.safeParse({ ok: false, code: "unauthorized", message: "x" }).success,
    ).toBe(true);
    expect(
      ApiV1ErrorSchema.safeParse({ ok: false, code: "teapot", message: "x" }).success,
    ).toBe(false);
  });
});

describe("api key authentication", () => {
  const KEY = "et_live_" + "a".repeat(32);

  function withKeys<T>(value: string, fn: () => T): T {
    const prev = process.env.ET_API_KEYS;
    process.env.ET_API_KEYS = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.ET_API_KEYS;
      else process.env.ET_API_KEYS = prev;
    }
  }

  it("identifies a configured key and reports its label", () => {
    withKeys(`stadtwerke-mainz:${hashApiKey(KEY)}`, () => {
      const id = identifyApiKey(KEY);
      expect(id?.label).toBe("stadtwerke-mainz");
      expect(id?.fingerprint).toHaveLength(8);
    });
  });

  // The plaintext key is never stored, so a leaked environment yields no keys.
  it("never exposes the key itself in the identity", () => {
    withKeys(`client:${hashApiKey(KEY)}`, () => {
      expect(JSON.stringify(identifyApiKey(KEY))).not.toContain(KEY);
    });
  });

  it("rejects an unknown key", () => {
    withKeys(`client:${hashApiKey(KEY)}`, () => {
      expect(identifyApiKey("et_live_" + "b".repeat(32))).toBeNull();
    });
  });

  it("rejects a missing, short or unprefixed key", () => {
    withKeys(`client:${hashApiKey(KEY)}`, () => {
      expect(identifyApiKey(undefined)).toBeNull();
      expect(identifyApiKey("")).toBeNull();
      expect(identifyApiKey("et_short")).toBeNull();
      expect(identifyApiKey("a".repeat(40))).toBeNull();
    });
  });

  it("rejects everything when no keys are configured", () => {
    withKeys("", () => expect(identifyApiKey(KEY)).toBeNull());
  });

  it("skips malformed configuration entries instead of trusting them", () => {
    withKeys(`broken-no-hash,other:zzzz,good:${hashApiKey(KEY)}`, () => {
      expect(identifyApiKey(KEY)?.label).toBe("good");
    });
  });

  it("reads the key from Authorization or X-API-Key", () => {
    expect(extractApiKey({ authorization: `Bearer ${KEY}` })).toBe(KEY);
    expect(extractApiKey({ "x-api-key": KEY })).toBe(KEY);
    expect(extractApiKey({ authorization: "Basic abc" })).toBeUndefined();
    expect(extractApiKey({})).toBeUndefined();
  });

  it("hashes to 64 hex chars, deterministically", () => {
    expect(hashApiKey(KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(KEY)).toBe(hashApiKey(KEY));
    expect(hashApiKey(KEY)).not.toBe(hashApiKey(KEY + "x"));
  });
});
