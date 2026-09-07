import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ANALYTICS_EVENTS,
  analyticsDomain,
  doNotTrackEnabled,
  resetAnalyticsForTests,
  sanitiseProps,
  track,
  type AnalyticsEvent,
} from "./analytics";

describe("sanitiseProps — the privacy boundary", () => {
  it("keeps low-cardinality categories, counts and flags", () => {
    expect(
      sanitiseProps({ verdict: "REQUIRES_REVIEW", missing: 2, overdue: true }),
    ).toEqual({ verdict: "REQUIRES_REVIEW", missing: 2, overdue: true });
  });

  it("drops anything containing an email address", () => {
    expect(sanitiseProps({ who: "kunde@example.de" })).toEqual({});
    expect(sanitiseProps({ note: "ping a@b.de" })).toEqual({});
  });

  it("drops phone numbers", () => {
    expect(sanitiseProps({ tel: "+49 69 1234567" })).toEqual({});
    expect(sanitiseProps({ tel: "069-1234567" })).toEqual({});
  });

  it("drops German postal codes", () => {
    expect(sanitiseProps({ ort: "60311 Frankfurt" })).toEqual({});
  });

  // Long values are dropped outright rather than shortened.
  it("drops free text instead of truncating it", () => {
    const long = "Musterstrasse 12, Hinterhaus, bei Familie Schmidt, 3. OG links";
    expect(sanitiseProps({ location: long })).toEqual({});
  });

  it("drops empty, null, undefined and non-finite values", () => {
    expect(
      sanitiseProps({
        a: "",
        b: "   ",
        c: null as unknown as string,
        d: undefined as unknown as string,
        e: NaN,
        f: Infinity,
      }),
    ).toEqual({});
  });

  it("caps the number of properties", () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`k${i}`, i]),
    );
    expect(Object.keys(sanitiseProps(many))).toHaveLength(8);
  });

  it("returns an empty object for no props at all", () => {
    expect(sanitiseProps()).toEqual({});
    expect(sanitiseProps({})).toEqual({});
  });
});

describe("event vocabulary", () => {
  it("covers the whole funnel from first interaction to payment", () => {
    const expected: AnalyticsEvent[] = [
      "calculator_used",
      "eligibility_verdict",
      "next_step_shown",
      "next_step_clicked",
      "lead_captured",
      "checkout_started",
      "checkout_succeeded",
      "checkout_canceled",
      "messkonzept_derived",
      "allocation_compared",
    ];
    expect([...ANALYTICS_EVENTS]).toEqual(expected);
  });

  it("uses stable snake_case names, since renaming one breaks history", () => {
    for (const e of ANALYTICS_EVENTS) {
      expect(e).toMatch(/^[a-z][a-z_]*[a-z]$/);
    }
  });
});

describe("track", () => {
  const original = globalThis.window;

  beforeEach(() => {
    resetAnalyticsForTests();
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  function fakeWindow(overrides: Record<string, unknown> = {}) {
    const calls: Array<[string, unknown]> = [];
    const win = {
      navigator: { doNotTrack: "0" },
      location: { hostname: "energie-teilen.de" },
      plausible: (event: string, opts?: unknown) => calls.push([event, opts]),
      ...overrides,
    };
    (globalThis as { window?: unknown }).window = win;
    return { calls, win };
  }

  it("sends the event with sanitised props", () => {
    const { calls } = fakeWindow();
    track("eligibility_verdict", { verdict: "ELIGIBLE", missing: 0 });
    expect(calls).toEqual([
      ["eligibility_verdict", { props: { verdict: "ELIGIBLE", missing: 0 } }],
    ]);
  });

  it("sends a bare event when every prop was stripped", () => {
    const { calls } = fakeWindow();
    track("lead_captured", { email: "kunde@example.de" });
    expect(calls).toEqual([["lead_captured", undefined]]);
  });

  it("stays silent when Do Not Track is on", () => {
    const { calls } = fakeWindow({ navigator: { doNotTrack: "1" } });
    track("calculator_used");
    expect(calls).toEqual([]);
  });

  // Analytics must never be able to break the calculator.
  it("swallows a transport that throws", () => {
    fakeWindow({
      plausible: () => {
        throw new Error("blocked by extension");
      },
    });
    expect(() => track("calculator_used")).not.toThrow();
  });

  it("does nothing when the script never loaded", () => {
    fakeWindow({ plausible: undefined });
    expect(() => track("calculator_used")).not.toThrow();
  });
});

describe("domain resolution", () => {
  const original = globalThis.window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
    vi.unstubAllEnvs();
  });

  it("prefers an explicitly configured domain", () => {
    vi.stubEnv("VITE_PLAUSIBLE_DOMAIN", "energie-teilen.de");
    (globalThis as { window?: unknown }).window = {
      location: { hostname: "energie-teilen-site.vercel.app" },
      navigator: {},
    };
    expect(analyticsDomain()).toBe("energie-teilen.de");
  });

  it("falls back to the actual host rather than a hard-coded guess", () => {
    vi.stubEnv("VITE_PLAUSIBLE_DOMAIN", "");
    (globalThis as { window?: unknown }).window = {
      location: { hostname: "energie-teilen-site.vercel.app" },
      navigator: {},
    };
    expect(analyticsDomain()).toBe("energie-teilen-site.vercel.app");
  });
});

describe("doNotTrackEnabled", () => {
  const original = globalThis.window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  it("recognises the shapes browsers actually use", () => {
    for (const nav of [{ doNotTrack: "1" }, { doNotTrack: "yes" }, { msDoNotTrack: "1" }]) {
      (globalThis as { window?: unknown }).window = { navigator: nav };
      expect(doNotTrackEnabled()).toBe(true);
    }
    (globalThis as { window?: unknown }).window = { navigator: { doNotTrack: "0" } };
    expect(doNotTrackEnabled()).toBe(false);
  });
});
