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
  AllocationRequestSchema,
  AllocationResponseSchema,
  MesskonzeptRequestSchema,
  MesskonzeptResponseSchema,
  BillingRequestSchema,
  BillingResponseSchema,
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

describe("messkonzept contract", () => {
  it("requires the constellation, not just a plant size", () => {
    expect(MesskonzeptRequestSchema.safeParse({}).success).toBe(false);
    expect(
      MesskonzeptRequestSchema.safeParse({ constellation: { units: 20, kwp: 60 } }).success,
    ).toBe(true);
  });

  it("rejects an unknown grid-connection value rather than falling back", () => {
    expect(
      MesskonzeptRequestSchema.safeParse({
        constellation: { units: 20, kwp: 60, gridConnection: "irgendwas" },
      }).success,
    ).toBe(false);
  });

  it("carries the model stamp, the critical path and the disclaimer", () => {
    expect(MesskonzeptResponseSchema.shape.model).toBeDefined();
    expect(MesskonzeptResponseSchema.shape.criticalPath).toBeDefined();
    expect(MesskonzeptResponseSchema.shape.disclaimer).toBeDefined();
  });

  it("keeps a not-determinable verdict expressible in the response", () => {
    expect(
      MesskonzeptResponseSchema.shape.variant.safeParse("not_determinable").success,
    ).toBe(true);
  });
});

describe("allocation contract", () => {
  const base = {
    generationKwh: [1, 2, 3],
    participants: [{ id: "a", consumptionKwh: [1, 1, 1] }],
  };

  it("treats the key as optional, so a comparison is the default", () => {
    const r = AllocationRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.key).toBeUndefined();
      expect(r.data.includeSeries).toBe(false);
    }
  });

  it("accepts a single named key", () => {
    expect(AllocationRequestSchema.safeParse({ ...base, key: "cascading" }).success).toBe(true);
  });

  it("rejects an unknown key", () => {
    expect(AllocationRequestSchema.safeParse({ ...base, key: "irgendwie" }).success).toBe(false);
  });

  it("rejects negative energy and empty series at the boundary", () => {
    expect(
      AllocationRequestSchema.safeParse({ ...base, generationKwh: [-1, 0, 0] }).success,
    ).toBe(false);
    expect(AllocationRequestSchema.safeParse({ ...base, generationKwh: [] }).success).toBe(false);
    expect(AllocationRequestSchema.safeParse({ ...base, participants: [] }).success).toBe(false);
  });

  it("bounds the request so one call cannot become an unbounded computation", () => {
    expect(
      AllocationRequestSchema.safeParse({
        ...base,
        generationKwh: new Array(40_000).fill(0),
      }).success,
    ).toBe(false);
    expect(
      AllocationRequestSchema.safeParse({
        ...base,
        participants: Array.from({ length: 600 }, (_, i) => ({
          id: `p${i}`,
          consumptionKwh: [1, 1, 1],
        })),
      }).success,
    ).toBe(false);
  });

  it("returns a run per key, and a recommendation only for a comparison", () => {
    expect(AllocationResponseSchema.shape.runs).toBeDefined();
    expect(AllocationResponseSchema.shape.recommendation.safeParse(null).success).toBe(true);
  });
});

describe("billing contract", () => {
  const base = {
    period: { from: "2026-01-01", to: "2027-01-01" },
    tariff: { mieterstromCtPerKwh: 28, reststromCtPerKwh: 34, grundpreisEurPerYear: 120 },
    participants: [{ id: "we-1", allocatedKwh: 1200, gridDrawKwh: 1800 }],
  };

  it("accepts a period, a tariff and at least one participant", () => {
    expect(BillingRequestSchema.safeParse(base).success).toBe(true);
    expect(BillingRequestSchema.safeParse({ ...base, participants: [] }).success).toBe(false);
  });

  it("rejects a reversed period rather than billing backwards", () => {
    expect(
      BillingRequestSchema.safeParse({
        ...base,
        period: { from: "2027-01-01", to: "2026-01-01" },
      }).success,
    ).toBe(false);
  });

  it("treats the basic-supply reference as optional", () => {
    expect(
      BillingRequestSchema.safeParse({
        ...base,
        tariff: { ...base.tariff, grundversorgungCtPerKwh: 36 },
      }).success,
    ).toBe(true);
  });

  it("returns the reconciliation alongside the statements", () => {
    expect(BillingResponseSchema.shape.reconciliation).toBeDefined();
    expect(BillingResponseSchema.shape.conventions).toBeDefined();
    expect(BillingResponseSchema.shape.disclaimer).toBeDefined();
  });

  it("keeps every money field an integer count of cents", () => {
    const totals = BillingResponseSchema.shape.totals;
    expect(totals.shape.grossCents.safeParse(1234).success).toBe(true);
    expect(totals.shape.grossCents.safeParse(12.34).success).toBe(false);
  });
});
