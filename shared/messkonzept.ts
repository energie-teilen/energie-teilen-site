/**
 * shared/messkonzept.ts
 *
 * Metering-concept generator.
 *
 * Economics decide whether a project is worth doing; the metering concept
 * decides whether it can be built. It determines how many meters are needed,
 * who operates them, which market roles must be filled, and which of those are
 * on the critical path. Getting it wrong is the most common reason a
 * financially sound constellation never goes into operation.
 *
 * This module derives that concept deterministically from the constellation.
 * Same rules every time, no inference, and an explicit "not determinable"
 * verdict when the inputs do not decide it.
 *
 * Scope: it produces an engineering proposal — meter inventory, market roles
 * and the ordered task list. It does not assert legal admissibility, and it
 * does not replace the Netzbetreiber's own Messkonzept approval, which is
 * always the last word.
 */

import { z } from "zod";
import {
  BuildingScopeSchema,
  GenerationStatusSchema,
  MeteringStatusSchema,
  OwnerConstellationSchema,
  type BuildingScope,
} from "./eligibility.js";

// ============================================================================
// INPUT
// ============================================================================

export const StorageSchema = z.enum(["none", "planned", "existing"]);
export type Storage = z.infer<typeof StorageSchema>;

export const GridConnectionSchema = z.enum([
  /** One Hausanschluss serves every unit — the summation case. */
  "single_connection",
  /** Each unit has its own Hausanschluss / Netzanschlusspunkt. */
  "per_unit_connection",
  /** Participants sit on the public grid at different connection points. */
  "public_grid",
]);
export type GridConnection = z.infer<typeof GridConnectionSchema>;

export const MesskonzeptInputSchema = z.object({
  units: z.number().int().positive().max(2000),
  kwp: z.number().positive().max(5000),
  gridConnection: GridConnectionSchema.optional(),
  buildingScope: BuildingScopeSchema.optional(),
  ownerConstellation: OwnerConstellationSchema.optional(),
  generationStatus: GenerationStatusSchema.optional(),
  metering: MeteringStatusSchema.optional(),
  storage: StorageSchema.optional(),
  /** Commercial units change the tariff and metering obligations. */
  commercialUnits: z.number().int().nonnegative().max(2000).optional(),
});
export type MesskonzeptInput = z.infer<typeof MesskonzeptInputSchema>;

// ============================================================================
// OUTPUT
// ============================================================================

export const MesskonzeptVariantSchema = z.enum([
  /** Summenzählermodell: one bidirectional meter at the connection point. */
  "summenzaehler",
  /** Every unit metered individually at its own connection point. */
  "einzelzaehler",
  /** Participants on the public grid, each with interval metering. */
  "viertelstunden_bilanzierung",
  "not_determinable",
]);
export type MesskonzeptVariant = z.infer<typeof MesskonzeptVariantSchema>;

export const VARIANT_LABEL_DE: Record<MesskonzeptVariant, string> = {
  summenzaehler: "Summenzählermodell",
  einzelzaehler: "Einzelzählermodell",
  viertelstunden_bilanzierung: "Viertelstundenbilanzierung über das öffentliche Netz",
  not_determinable: "Nicht bestimmbar",
};

export type MeterSpec = {
  code: string;
  label: string;
  /** How many of this meter the concept needs. */
  count: number;
  bidirectional: boolean;
  /** Requires Zählerstandsgangmessung / 15-minute values. */
  intervalMetering: boolean;
  purpose: string;
};

export type MarketRole = {
  code: string;
  label: string;
  /** Who typically fills it in this constellation. */
  filledBy: string;
  responsibility: string;
};

export type MesskonzeptTask = {
  code: string;
  title: string;
  owner: string;
  /** Nothing downstream can proceed until this is done. */
  blocking: boolean;
};

export type MesskonzeptResult = {
  variant: MesskonzeptVariant;
  variantLabel: string;
  rationale: string;
  meters: MeterSpec[];
  /** Total physical meters, derived from the inventory. */
  meterCount: number;
  roles: MarketRole[];
  tasks: MesskonzeptTask[];
  warnings: { code: string; message: string }[];
  /** What the caller still has to supply for a firmer answer. */
  missingInputs: string[];
  confidence: "high" | "medium" | "insufficient_data";
  disclaimer: string;
};

export const MESSKONZEPT_DISCLAIMER_DE =
  "Vorschlag für die technische Ausgestaltung. Das Messkonzept ist mit dem zuständigen Netzbetreiber und Messstellenbetreiber abzustimmen; deren Freigabe ist maßgeblich.";

// ============================================================================
// DERIVATION
// ============================================================================

/**
 * Infer the grid-connection situation when it was not supplied.
 *
 * Only the unambiguous case is inferred: participants spread across the public
 * grid cannot be behind one Hausanschluss. Everything else stays unknown, so
 * the result reports lower confidence rather than assuming the common case.
 */
function inferGridConnection(input: MesskonzeptInput): GridConnection | null {
  if (input.gridConnection) return input.gridConnection;
  if (input.buildingScope === "across_grid") return "public_grid";
  return null;
}

function selectVariant(
  input: MesskonzeptInput,
  grid: GridConnection | null,
): { variant: MesskonzeptVariant; rationale: string } {
  if (grid === "public_grid") {
    return {
      variant: "viertelstunden_bilanzierung",
      rationale:
        "Die Beteiligten liegen an unterschiedlichen Netzanschlusspunkten. Eine Summenbildung hinter einem Hausanschluss ist damit ausgeschlossen; die Zuordnung erfolgt rechnerisch über viertelstündliche Messwerte.",
    };
  }

  if (grid === "per_unit_connection") {
    return {
      variant: "einzelzaehler",
      rationale:
        "Jede Einheit verfügt über einen eigenen Netzanschluss. Eine gemeinsame Summenzählung entfällt; jede Entnahmestelle wird einzeln gemessen.",
    };
  }

  if (grid === "single_connection") {
    return {
      variant: "summenzaehler",
      rationale:
        "Alle Einheiten liegen hinter einem gemeinsamen Hausanschluss. Der Netzbezug wird an einem Zweirichtungszähler am Netzanschlusspunkt gemessen, die Einheiten über Unterzähler dahinter.",
    };
  }

  return {
    variant: "not_determinable",
    rationale:
      "Ohne Angabe zur Netzanschlusssituation lässt sich das Messkonzept nicht festlegen: die Wahl zwischen Summen- und Einzelzählung hängt genau daran.",
  };
}

function buildMeters(
  input: MesskonzeptInput,
  variant: MesskonzeptVariant,
): MeterSpec[] {
  const meters: MeterSpec[] = [];
  const needsInterval = variant === "viertelstunden_bilanzierung";

  if (variant === "not_determinable") return meters;

  // Generation is always metered separately: the plant's output has to be
  // known independently of what any unit consumes.
  meters.push({
    code: "erzeugungszaehler",
    label: "Erzeugungszähler",
    count: 1,
    bidirectional: false,
    intervalMetering: needsInterval,
    purpose: "Erfasst die Gesamterzeugung der Anlage, getrennt vom Verbrauch.",
  });

  if (variant === "summenzaehler") {
    meters.push({
      code: "summenzaehler",
      label: "Zweirichtungszähler am Netzanschlusspunkt",
      count: 1,
      bidirectional: true,
      intervalMetering: false,
      purpose: "Misst Netzbezug und Überschusseinspeisung der gesamten Liegenschaft.",
    });
    meters.push({
      code: "unterzaehler",
      label: "Unterzähler je Einheit",
      count: input.units,
      bidirectional: false,
      intervalMetering: false,
      purpose: "Erfasst den Verbrauch jeder Einheit hinter dem Summenzähler.",
    });
  }

  if (variant === "einzelzaehler") {
    meters.push({
      code: "entnahmezaehler",
      label: "Entnahmezähler je Einheit",
      count: input.units,
      bidirectional: false,
      intervalMetering: false,
      purpose: "Jede Einheit wird an ihrem eigenen Netzanschlusspunkt gemessen.",
    });
  }

  if (variant === "viertelstunden_bilanzierung") {
    meters.push({
      code: "teilnehmerzaehler",
      label: "Zähler je Teilnehmer mit Zählerstandsgangmessung",
      count: input.units,
      bidirectional: false,
      intervalMetering: true,
      purpose:
        "Viertelstündliche Messwerte je Teilnehmer als Grundlage der rechnerischen Zuordnung.",
    });
  }

  if (input.storage === "planned" || input.storage === "existing") {
    meters.push({
      code: "speicherzaehler",
      label: "Speicherzähler",
      count: 1,
      bidirectional: true,
      intervalMetering: needsInterval,
      purpose:
        "Trennt Ein- und Ausspeicherung, damit gespeicherter Strom nicht doppelt zugeordnet wird.",
    });
  }

  return meters;
}

function buildRoles(input: MesskonzeptInput, variant: MesskonzeptVariant): MarketRole[] {
  if (variant === "not_determinable") return [];

  const operatorDefault =
    input.ownerConstellation === "weg"
      ? "Eigentümergemeinschaft oder ein von ihr beauftragter Dienstleister"
      : input.ownerConstellation === "multiple_owners"
        ? "Gesondert zu vereinbaren — mehrere Eigentümer"
        : "Eigentümer oder ein beauftragter Dienstleister";

  const roles: MarketRole[] = [
    {
      code: "anlagenbetreiber",
      label: "Anlagenbetreiber",
      filledBy: operatorDefault,
      responsibility: "Betreibt die Erzeugungsanlage und trägt das wirtschaftliche Risiko.",
    },
    {
      code: "lieferant",
      label: "Lieferant",
      filledBy: "Anlagenbetreiber oder ein beauftragter Energiedienstleister",
      responsibility:
        "Beliefert die Teilnehmer, rechnet ab und erfüllt die Lieferantenpflichten.",
    },
    {
      code: "msb",
      label: "Messstellenbetreiber",
      filledBy: "Grundzuständiger MSB, sofern kein wettbewerblicher MSB beauftragt wird",
      responsibility: "Baut, betreibt und liest die Messeinrichtungen.",
    },
    {
      code: "vnb",
      label: "Verteilnetzbetreiber",
      filledBy: "Örtlicher Netzbetreiber",
      responsibility: "Genehmigt das Messkonzept und den Netzanschluss.",
    },
  ];

  if (variant === "viertelstunden_bilanzierung") {
    roles.push({
      code: "bkv",
      label: "Bilanzkreisverantwortlicher",
      filledBy: "Lieferant oder beauftragter Dienstleister",
      responsibility:
        "Führt den Bilanzkreis und verantwortet die viertelstündliche Bilanzierung.",
    });
    roles.push({
      code: "direktvermarkter",
      label: "Direktvermarkter",
      filledBy: "Zu beauftragen",
      responsibility: "Vermarktet den nicht zugeordneten Überschuss.",
    });
  }

  return roles;
}

function buildTasks(
  input: MesskonzeptInput,
  variant: MesskonzeptVariant,
  meters: MeterSpec[],
): MesskonzeptTask[] {
  if (variant === "not_determinable") {
    return [
      {
        code: "clarify_grid_connection",
        title:
          "Netzanschlusssituation klären: ein gemeinsamer Hausanschluss, je Einheit ein Anschluss, oder Beteiligte im öffentlichen Netz.",
        owner: "Eigentümer / Verwaltung",
        blocking: true,
      },
    ];
  }

  const intervalMeters = meters.filter((m) => m.intervalMetering).reduce((s, m) => s + m.count, 0);

  const tasks: MesskonzeptTask[] = [
    {
      code: "messkonzept_submit",
      title: "Messkonzept beim Netzbetreiber einreichen und freigeben lassen.",
      owner: "Anlagenbetreiber",
      blocking: true,
    },
    {
      code: "msb_appoint",
      title:
        intervalMeters > 0
          ? `Messstellenbetreiber beauftragen — ${intervalMeters} Messpunkte benötigen Zählerstandsgangmessung.`
          : "Messstellenbetreiber beauftragen und Einbautermine abstimmen.",
      owner: "Anlagenbetreiber",
      blocking: true,
    },
    {
      code: "marktrollen_register",
      title: "Marktrollen registrieren und in der Marktkommunikation anmelden.",
      owner: "Lieferant",
      blocking: true,
    },
    {
      code: "contracts",
      title:
        variant === "viertelstunden_bilanzierung"
          ? "Je Teilnehmer zwei Verträge schließen: Liefervertrag und Vertrag zur gemeinsamen Nutzung mit Aufteilungsschlüssel."
          : "Lieferverträge mit den Teilnehmern schließen.",
      owner: "Lieferant",
      blocking: true,
    },
    {
      code: "abrechnung",
      title: "Abrechnungsprozess aufsetzen: Ablesung, Zuordnung, Rechnungsstellung.",
      owner: "Lieferant",
      blocking: false,
    },
  ];

  if (input.ownerConstellation === "weg") {
    tasks.unshift({
      code: "weg_beschluss",
      title: "Beschluss der Eigentümergemeinschaft herbeiführen.",
      owner: "Verwaltung",
      blocking: true,
    });
  }

  if (input.storage !== undefined && input.storage !== "none") {
    tasks.push({
      code: "speicher_messkonzept",
      title: "Speicher im Messkonzept abbilden, damit Ein- und Ausspeicherung getrennt erfasst werden.",
      owner: "Anlagenbetreiber",
      blocking: false,
    });
  }

  return tasks;
}

function buildWarnings(
  input: MesskonzeptInput,
  variant: MesskonzeptVariant,
  meters: MeterSpec[],
): { code: string; message: string }[] {
  const warnings: { code: string; message: string }[] = [];

  const intervalMeters = meters.filter((m) => m.intervalMetering).reduce((s, m) => s + m.count, 0);
  if (intervalMeters > 0) {
    warnings.push({
      code: "interval_metering_required",
      message: `${intervalMeters} Messpunkte benötigen viertelstündliche Messwerte. Die Verfügbarkeit intelligenter Messsysteme ist beim zuständigen Messstellenbetreiber vorab zu klären; sie ist in der Praxis der häufigste Terminrisikofaktor.`,
    });
  }

  if (input.metering === "unclear") {
    warnings.push({
      code: "metering_unclear",
      message:
        "Das bestehende Zählerkonzept ist ungeklärt. Vor jeder Kostenschätzung ist die vorhandene Zählerstruktur aufzunehmen.",
    });
  }

  if (input.generationStatus === "existing") {
    warnings.push({
      code: "existing_plant_rewiring",
      message:
        "Bei einer Bestandsanlage ist zu prüfen, ob die bestehende Vergütungsform und Verschaltung den Wechsel in dieses Modell zulassen.",
    });
  }

  if ((input.commercialUnits ?? 0) > 0) {
    warnings.push({
      code: "commercial_units",
      message: `${input.commercialUnits} gewerbliche Einheiten: abweichende Abrechnungs- und ggf. Messpflichten sind gesondert zu prüfen.`,
    });
  }

  if (variant === "summenzaehler" && input.units > 100) {
    warnings.push({
      code: "large_submetering",
      message: `${input.units} Unterzähler bedeuten erheblichen Mess- und Abrechnungsaufwand. Ein wettbewerblicher Messstellenbetreiber ist hier meist wirtschaftlicher als der grundzuständige.`,
    });
  }

  return warnings;
}

const INPUT_LABELS: Record<string, string> = {
  gridConnection: "Netzanschlusssituation",
  buildingScope: "Räumlicher Zuschnitt",
  ownerConstellation: "Eigentümerkonstellation",
  generationStatus: "Status der Erzeugungsanlage",
  metering: "Bestehendes Zählerkonzept",
  storage: "Speicher",
};

function missingInputsOf(input: MesskonzeptInput): string[] {
  return Object.keys(INPUT_LABELS)
    .filter((k) => input[k as keyof MesskonzeptInput] === undefined)
    .map((k) => INPUT_LABELS[k]);
}

/**
 * Derive the metering concept.
 *
 * Deterministic: the same input always yields the same concept, meter
 * inventory, roles and tasks.
 */
export function deriveMesskonzept(input: MesskonzeptInput): MesskonzeptResult {
  const grid = inferGridConnection(input);
  const { variant, rationale } = selectVariant(input, grid);
  const meters = buildMeters(input, variant);
  const missingInputs = missingInputsOf(input);

  const confidence: MesskonzeptResult["confidence"] =
    variant === "not_determinable"
      ? "insufficient_data"
      : missingInputs.length > 2
        ? "medium"
        : "high";

  return {
    variant,
    variantLabel: VARIANT_LABEL_DE[variant],
    rationale,
    meters,
    meterCount: meters.reduce((s, m) => s + m.count, 0),
    roles: buildRoles(input, variant),
    tasks: buildTasks(input, variant, meters),
    warnings: buildWarnings(input, variant, meters),
    missingInputs,
    confidence,
    disclaimer: MESSKONZEPT_DISCLAIMER_DE,
  };
}

/** Blocking tasks only, in order — the critical path to operation. */
export function criticalPath(result: MesskonzeptResult): MesskonzeptTask[] {
  return result.tasks.filter((t) => t.blocking);
}

export type { BuildingScope };
