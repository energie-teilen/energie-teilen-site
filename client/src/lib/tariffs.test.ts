import { describe, it, expect } from "vitest";
import {
  CO2_FACTOR,
  FEED_IN_TARIFF,
  FIXED_TARIFF_REGIME,
  MIETERSTROM_PRICE_CAP_SHARE,
  MIETERSTROM_ZUSCHLAG,
  DATED_TABLES,
  EXPIRY_WARNING_DAYS,
  bandLabel,
  expiredTables,
  freshness,
  freshnessReport,
  lookupRate,
  maxMieterstromPrice,
  priceCapCheck,
  regimeWarning,
} from "../../../shared/tariffs";
import { DEFAULTS } from "./mieterstrom";

describe("size-banded rates", () => {
  it("picks the band the plant actually falls in", () => {
    expect(lookupRate(FEED_IN_TARIFF, 8)).toBe(7.7);
    expect(lookupRate(FEED_IN_TARIFF, 30)).toBe(6.66);
    expect(lookupRate(FEED_IN_TARIFF, 80)).toBe(5.44);
    expect(lookupRate(MIETERSTROM_ZUSCHLAG, 8)).toBe(2.54);
    expect(lookupRate(MIETERSTROM_ZUSCHLAG, 30)).toBe(2.36);
    expect(lookupRate(MIETERSTROM_ZUSCHLAG, 80)).toBe(1.29);
  });

  it("treats band edges as inclusive upper bounds", () => {
    expect(lookupRate(FEED_IN_TARIFF, 10)).toBe(7.7);
    expect(lookupRate(FEED_IN_TARIFF, 10.01)).toBe(6.66);
    expect(lookupRate(FEED_IN_TARIFF, 40)).toBe(6.66);
  });

  it("refuses to extrapolate above the published schedule", () => {
    expect(lookupRate(FEED_IN_TARIFF, 250)).toBeNull();
    expect(lookupRate(MIETERSTROM_ZUSCHLAG, 250)).toBeNull();
  });

  it("rejects nonsense sizes instead of returning a plausible rate", () => {
    expect(lookupRate(FEED_IN_TARIFF, 0)).toBeNull();
    expect(lookupRate(FEED_IN_TARIFF, -5)).toBeNull();
    expect(lookupRate(FEED_IN_TARIFF, NaN)).toBeNull();
  });

  it("names the band for a report", () => {
    expect(bandLabel(FEED_IN_TARIFF, 30)).toBe("10–40 kWp");
    expect(bandLabel(FEED_IN_TARIFF, 250)).toBe("> 100 kWp");
  });

  it("carries a validity window, because a rate without one goes stale silently", () => {
    expect(FEED_IN_TARIFF.validFrom).toBe("2026-08-01");
    expect(FEED_IN_TARIFF.validUntil).toBe("2027-01-31");
    expect(FEED_IN_TARIFF.legalBasis).toContain("EEG");
  });

  it("the shipped defaults now agree with the published bands", () => {
    expect(DEFAULTS.einspeiseverguetungCtPerKwh).toBe(lookupRate(FEED_IN_TARIFF, DEFAULTS.kwp));
    expect(DEFAULTS.mieterstromZuschlagCtPerKwh).toBe(
      lookupRate(MIETERSTROM_ZUSCHLAG, DEFAULTS.kwp),
    );
  });
});

describe("sourcing discipline", () => {
  // A value read from the body that publishes it may be verified. A value read
  // from someone's summary of that body may not.
  it("marks rates taken from a secondary summary as unverified", () => {
    expect(FEED_IN_TARIFF.verified).toBe(false);
    expect(MIETERSTROM_ZUSCHLAG.verified).toBe(false);
    expect(FIXED_TARIFF_REGIME.verified).toBe(false);
  });

  it("marks the UBA emission factor verified, read from UBA itself", () => {
    expect(CO2_FACTOR.verified).toBe(true);
    expect(CO2_FACTOR.reference).toContain("Umweltbundesamt");
    expect(CO2_FACTOR.tPerMwh).toBe(0.344);
  });

  it("gives every entry a reference and a date", () => {
    for (const t of [FEED_IN_TARIFF, MIETERSTROM_ZUSCHLAG, CO2_FACTOR, FIXED_TARIFF_REGIME]) {
      expect(t.reference.length).toBeGreaterThan(20);
      expect(t.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("§ 42a price cap", () => {
  it("caps the tenant price at 90% of the local basic-supply tariff", () => {
    expect(MIETERSTROM_PRICE_CAP_SHARE).toBe(0.9);
    expect(maxMieterstromPrice(40)).toBe(36);
  });

  it("flags a price above the cap", () => {
    expect(priceCapCheck(37, 40)).toEqual({ status: "over_cap", capCtPerKwh: 36 });
    expect(priceCapCheck(32, 40)).toEqual({ status: "ok", capCtPerKwh: 36 });
  });

  // Same discipline as the eligibility engine: unknown is a state, not a guess.
  it("answers unknown rather than inventing a reference tariff", () => {
    expect(priceCapCheck(32)).toEqual({ status: "unknown", capCtPerKwh: null });
    expect(priceCapCheck(32, NaN)).toEqual({ status: "unknown", capCtPerKwh: null });
  });
});

describe("the regime clock", () => {
  // The 20-year model assumes a fixed feed-in tariff for the whole term, and
  // that regime is being abolished for new plants.
  it("warns when commissioning falls after the fixed-tariff era", () => {
    const w = regimeWarning(2028);
    expect(w.applies).toBe(true);
    expect(w.headline).toContain("2028");
    expect(w.detail).toContain("Direktvermarktung");
    expect(w.detail).toContain("strukturell zu optimistisch");
  });

  it("stays quiet for a plant commissioned inside the era", () => {
    expect(regimeWarning(2026).applies).toBe(false);
    expect(regimeWarning(2025).applies).toBe(false);
  });

  it("treats a missing commissioning year as worth flagging, not as safe", () => {
    const w = regimeWarning();
    expect(w.applies).toBe(true);
    expect(w.headline).toContain("nicht angegeben");
  });

  it("says plainly that self-consumption is unaffected", () => {
    expect(regimeWarning(2028).detail).toContain("Eigenverbrauchsanteil");
  });
});

describe("freshness", () => {
  const table = FEED_IN_TARIFF; // valid 2026-08-01 … 2027-01-31

  it("reports a rate inside its window as current", () => {
    const f = freshness(table, new Date("2026-09-06T12:00:00Z"));
    expect(f.status).toBe("current");
    expect(f.validUntil).toBe("2027-01-31");
    expect(f.daysRemaining).toBeGreaterThan(EXPIRY_WARNING_DAYS);
  });

  it("warns before the window closes, so a replacement can be sourced in time", () => {
    const f = freshness(table, new Date("2027-01-10T12:00:00Z"));
    expect(f.status).toBe("expiring");
    expect(f.daysRemaining).toBeLessThanOrEqual(EXPIRY_WARNING_DAYS);
    expect(f.daysRemaining).toBeGreaterThanOrEqual(0);
  });

  it("keeps a rate current through the whole of its closing day", () => {
    expect(freshness(table, new Date("2027-01-31T18:00:00Z")).status).toBe("expiring");
    expect(freshness(table, new Date("2027-02-01T00:00:01Z")).status).toBe("expired");
  });

  it("reports an open-ended table without inventing an end date", () => {
    const f = freshness(MIETERSTROM_ZUSCHLAG, new Date("2030-01-01T00:00:00Z"));
    expect(f.status).toBe("open_ended");
    expect(f.daysRemaining).toBeNull();
  });

  it("covers every dated table in the report", () => {
    expect(Object.keys(freshnessReport())).toEqual(Object.keys(DATED_TABLES));
  });

  // The guard: an expired rate must never ship silently.
  it("ships no expired rate today", () => {
    expect(expiredTables()).toEqual([]);
  });

  it("names the table that has expired when one has", () => {
    expect(expiredTables(new Date("2030-01-01T00:00:00Z"))).toContain("feedInTariff");
  });
});
