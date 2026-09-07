import { describe, it, expect } from "vitest";
import {
  MESSKONZEPT_DISCLAIMER_DE,
  MesskonzeptInputSchema,
  VARIANT_LABEL_DE,
  criticalPath,
  deriveMesskonzept,
  type MesskonzeptInput,
} from "../../../shared/messkonzept";

function build(over: Partial<MesskonzeptInput> = {}): MesskonzeptInput {
  return MesskonzeptInputSchema.parse({ units: 24, kwp: 60, ...over });
}

describe("variant selection", () => {
  it("chooses the summation model behind one house connection", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection" }));
    expect(r.variant).toBe("summenzaehler");
    expect(r.variantLabel).toBe(VARIANT_LABEL_DE.summenzaehler);
  });

  it("chooses individual metering when every unit has its own connection", () => {
    expect(deriveMesskonzept(build({ gridConnection: "per_unit_connection" })).variant).toBe(
      "einzelzaehler",
    );
  });

  it("chooses interval balancing for participants on the public grid", () => {
    expect(deriveMesskonzept(build({ gridConnection: "public_grid" })).variant).toBe(
      "viertelstunden_bilanzierung",
    );
  });

  // The one unambiguous inference: participants at different connection points
  // cannot sit behind a single Hausanschluss.
  it("infers the public grid from a scope spanning several sites", () => {
    const r = deriveMesskonzept(build({ buildingScope: "across_grid" }));
    expect(r.variant).toBe("viertelstunden_bilanzierung");
  });

  it("refuses to guess when the connection situation is unknown", () => {
    const r = deriveMesskonzept(build());
    expect(r.variant).toBe("not_determinable");
    expect(r.confidence).toBe("insufficient_data");
    expect(r.meters).toHaveLength(0);
    expect(r.roles).toHaveLength(0);
  });

  it("does not infer a connection situation from a single building alone", () => {
    // A single building can still have one connection per unit.
    expect(deriveMesskonzept(build({ buildingScope: "single_building" })).variant).toBe(
      "not_determinable",
    );
  });

  it("names clarifying the connection as the only task when nothing is determinable", () => {
    const r = deriveMesskonzept(build());
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].code).toBe("clarify_grid_connection");
    expect(r.tasks[0].blocking).toBe(true);
  });
});

describe("meter inventory", () => {
  it("always meters generation separately", () => {
    for (const gridConnection of ["single_connection", "per_unit_connection", "public_grid"] as const) {
      const r = deriveMesskonzept(build({ gridConnection }));
      expect(r.meters.map((m) => m.code)).toContain("erzeugungszaehler");
    }
  });

  it("counts one summation meter plus one submeter per unit", () => {
    const r = deriveMesskonzept(build({ units: 24, gridConnection: "single_connection" }));
    const byCode = Object.fromEntries(r.meters.map((m) => [m.code, m]));
    expect(byCode.summenzaehler.count).toBe(1);
    expect(byCode.summenzaehler.bidirectional).toBe(true);
    expect(byCode.unterzaehler.count).toBe(24);
    expect(r.meterCount).toBe(1 + 1 + 24);
  });

  it("counts one meter per unit for individual metering", () => {
    const r = deriveMesskonzept(build({ units: 12, gridConnection: "per_unit_connection" }));
    expect(r.meterCount).toBe(1 + 12);
  });

  it("flags interval metering only where the model requires it", () => {
    const summen = deriveMesskonzept(build({ gridConnection: "single_connection" }));
    expect(summen.meters.some((m) => m.intervalMetering)).toBe(false);

    const grid = deriveMesskonzept(build({ gridConnection: "public_grid" }));
    expect(grid.meters.filter((m) => m.intervalMetering).length).toBeGreaterThan(0);
  });

  it("adds a storage meter when storage is present or planned", () => {
    for (const storage of ["planned", "existing"] as const) {
      const r = deriveMesskonzept(build({ gridConnection: "single_connection", storage }));
      expect(r.meters.map((m) => m.code)).toContain("speicherzaehler");
    }
    const none = deriveMesskonzept(build({ gridConnection: "single_connection", storage: "none" }));
    expect(none.meters.map((m) => m.code)).not.toContain("speicherzaehler");
  });

  it("derives the meter count from the inventory rather than restating it", () => {
    const r = deriveMesskonzept(build({ units: 7, gridConnection: "single_connection", storage: "existing" }));
    expect(r.meterCount).toBe(r.meters.reduce((s, m) => s + m.count, 0));
  });
});

describe("market roles", () => {
  it("names the four roles every constellation has to fill", () => {
    const codes = deriveMesskonzept(build({ gridConnection: "single_connection" })).roles.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["anlagenbetreiber", "lieferant", "msb", "vnb"]));
  });

  it("adds balancing and marketing roles once the public grid is involved", () => {
    const codes = deriveMesskonzept(build({ gridConnection: "public_grid" })).roles.map((r) => r.code);
    expect(codes).toContain("bkv");
    expect(codes).toContain("direktvermarkter");
  });

  it("does not add a balancing role behind a single connection", () => {
    const codes = deriveMesskonzept(build({ gridConnection: "single_connection" })).roles.map((r) => r.code);
    expect(codes).not.toContain("bkv");
  });

  it("routes the operator role through the owners' association for a WEG", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection", ownerConstellation: "weg" }));
    expect(r.roles.find((x) => x.code === "anlagenbetreiber")!.filledBy).toMatch(/Eigentümergemeinschaft/);
  });
});

describe("tasks and critical path", () => {
  it("puts the owners' resolution first for a WEG", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection", ownerConstellation: "weg" }));
    expect(r.tasks[0].code).toBe("weg_beschluss");
  });

  it("omits the owners' resolution for a single owner", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection", ownerConstellation: "single_owner" }));
    expect(r.tasks.map((t) => t.code)).not.toContain("weg_beschluss");
  });

  it("returns only blocking tasks on the critical path, in order", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection", ownerConstellation: "weg" }));
    const path = criticalPath(r);
    expect(path.every((t) => t.blocking)).toBe(true);
    expect(path.map((t) => t.code)).toEqual(
      r.tasks.filter((t) => t.blocking).map((t) => t.code),
    );
    expect(path.map((t) => t.code)).not.toContain("abrechnung");
  });

  it("states the two-contract requirement only for the public-grid model", () => {
    const grid = deriveMesskonzept(build({ gridConnection: "public_grid" }));
    expect(grid.tasks.find((t) => t.code === "contracts")!.title).toMatch(/zwei Verträge/);

    const summen = deriveMesskonzept(build({ gridConnection: "single_connection" }));
    expect(summen.tasks.find((t) => t.code === "contracts")!.title).not.toMatch(/zwei Verträge/);
  });

  it("counts the interval measuring points into the metering-operator task", () => {
    const r = deriveMesskonzept(build({ units: 30, gridConnection: "public_grid" }));
    // 30 participant meters plus the generation meter.
    expect(r.tasks.find((t) => t.code === "msb_appoint")!.title).toMatch(/31 Messpunkte/);
  });

  it("adds a storage task when storage is in scope", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection", storage: "planned" }));
    expect(r.tasks.map((t) => t.code)).toContain("speicher_messkonzept");
  });
});

describe("warnings", () => {
  it("warns about interval metering availability where it is required", () => {
    const r = deriveMesskonzept(build({ gridConnection: "public_grid" }));
    expect(r.warnings.map((w) => w.code)).toContain("interval_metering_required");
  });

  it("warns when the existing metering situation is unclear", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection", metering: "unclear" }));
    expect(r.warnings.map((w) => w.code)).toContain("metering_unclear");
  });

  it("warns that an existing plant may not be convertible", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection", generationStatus: "existing" }));
    expect(r.warnings.map((w) => w.code)).toContain("existing_plant_rewiring");
  });

  it("warns about commercial units only when there are some", () => {
    const withCommercial = deriveMesskonzept(
      build({ gridConnection: "single_connection", commercialUnits: 3 }),
    );
    expect(withCommercial.warnings.map((w) => w.code)).toContain("commercial_units");

    const without = deriveMesskonzept(build({ gridConnection: "single_connection", commercialUnits: 0 }));
    expect(without.warnings.map((w) => w.code)).not.toContain("commercial_units");
  });

  it("warns about submetering effort above a hundred units", () => {
    const big = deriveMesskonzept(build({ units: 140, gridConnection: "single_connection" }));
    expect(big.warnings.map((w) => w.code)).toContain("large_submetering");

    const small = deriveMesskonzept(build({ units: 40, gridConnection: "single_connection" }));
    expect(small.warnings.map((w) => w.code)).not.toContain("large_submetering");
  });
});

describe("confidence and missing inputs", () => {
  it("names every unanswered input", () => {
    const r = deriveMesskonzept(build({ gridConnection: "single_connection" }));
    expect(r.missingInputs).toContain("Eigentümerkonstellation");
    expect(r.missingInputs).not.toContain("Netzanschlusssituation");
  });

  it("reports high confidence once most inputs are known", () => {
    const r = deriveMesskonzept(
      build({
        gridConnection: "single_connection",
        buildingScope: "single_building",
        ownerConstellation: "single_owner",
        generationStatus: "planned",
        metering: "ready",
        storage: "none",
      }),
    );
    expect(r.missingInputs).toHaveLength(0);
    expect(r.confidence).toBe("high");
  });

  it("drops to medium confidence while several inputs are open", () => {
    expect(deriveMesskonzept(build({ gridConnection: "single_connection" })).confidence).toBe("medium");
  });
});

describe("output discipline", () => {
  it("carries the approval disclaimer on every result", () => {
    for (const gridConnection of ["single_connection", "per_unit_connection", "public_grid"] as const) {
      expect(deriveMesskonzept(build({ gridConnection })).disclaimer).toBe(MESSKONZEPT_DISCLAIMER_DE);
    }
    expect(deriveMesskonzept(build()).disclaimer).toBe(MESSKONZEPT_DISCLAIMER_DE);
  });

  it("names the network operator's approval as authoritative", () => {
    expect(MESSKONZEPT_DISCLAIMER_DE).toMatch(/Netzbetreiber/);
    expect(MESSKONZEPT_DISCLAIMER_DE).toMatch(/maßgeblich/);
  });

  it("is deterministic", () => {
    const input = build({ gridConnection: "single_connection", ownerConstellation: "weg", storage: "planned" });
    expect(deriveMesskonzept(input)).toEqual(deriveMesskonzept(input));
  });

  it("rejects inputs outside the accepted range", () => {
    expect(() => MesskonzeptInputSchema.parse({ units: 0, kwp: 60 })).toThrow();
    expect(() => MesskonzeptInputSchema.parse({ units: 10, kwp: 0 })).toThrow();
    expect(() => MesskonzeptInputSchema.parse({ units: 10, kwp: 60, storage: "maybe" })).toThrow();
  });
});
