/**
 * shared/legal-entity.ts
 *
 * The operator's own identifying details, in one place.
 *
 * German law requires a provider to state who it is on an easily recognisable,
 * directly reachable page. Those details cannot be derived, inferred or
 * defaulted — they are facts about a specific legal entity, and inventing any
 * of them would be worse than not showing them.
 *
 * So this file has exactly two states:
 *
 *   configured: false — the details are not yet supplied. The legal pages say
 *     so plainly, the health endpoint reports the deployment as blocked, and
 *     legal-entity.test.ts fails, which stops a release that would otherwise
 *     publish empty obligations.
 *
 *   configured: true — every required field is filled with real data. The
 *     test then enforces that none of them is a leftover placeholder.
 *
 * There is deliberately no third state in which a placeholder reaches a
 * visitor: a page reading "[FIRMENNAME]" is not a lesser version of an
 * imprint, it is a page that fails its only purpose.
 *
 * To go live: fill every field below and set configured to true.
 *
 * This is the ONLY place the operator is described. The imprint, the privacy
 * notice, the terms, the footer, the PDF report, the confirmation email, the
 * discovery files and the health endpoint all read it through the helpers at
 * the end of this file; legal-identity.test.ts fails if a contact address or
 * an operator location is written anywhere else. The required fields are
 * documented in docs/RUNBOOK.md under "Operator identity".
 */

export type LegalEntity = {
  /** Flip to true only when every required field carries real data. */
  configured: boolean;

  /** Registered name including legal form, e.g. "Muster GmbH". */
  name: string;
  /** Street and house number. */
  street: string;
  /** Postal code. */
  postalCode: string;
  /** City. */
  city: string;
  /** Country, written out. */
  country: string;

  /** Person authorised to represent the entity. */
  representedBy: string;
  /** A telephone number that is actually answered. */
  phone: string;
  /** A monitored mailbox. */
  email: string;

  /** Companies-register court, or null for a form that has no registration. */
  registerCourt: string | null;
  /** Register number, or null. */
  registerNumber: string | null;
  /** VAT identification number, or null if none has been issued. */
  vatId: string | null;

  /** Person responsible for editorial content, where that applies. */
  contentResponsible: { name: string; address: string } | null;

  /** EU online dispute resolution platform reference. */
  disputeResolution: {
    /** Is the entity willing or obliged to take part in consumer arbitration? */
    participates: boolean;
    /** The body, when participates is true. */
    body: string | null;
  };
};

export const LEGAL_ENTITY: LegalEntity = {
  configured: false,

  name: "",
  street: "",
  postalCode: "",
  city: "",
  country: "Deutschland",

  representedBy: "",
  phone: "",
  email: "kontakt@energie-teilen.de",

  registerCourt: null,
  registerNumber: null,
  vatId: null,

  contentResponsible: null,

  disputeResolution: { participates: false, body: null },
};

/** Fields that must carry real data before the imprint can be published. */
export const REQUIRED_FIELDS = [
  "name",
  "street",
  "postalCode",
  "city",
  "country",
  "representedBy",
  "phone",
  "email",
] as const;

/** Shapes that indicate a template value rather than real data. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[[^\]]*\]/, // [FIRMENNAME]
  /\bXXX+/i,
  /\bplatzhalter\b/i,
  /\bmuster(mann|frau|stadt|str)/i,
  /\bTODO\b/i,
  /^\s*$/,
];

export type LegalEntityProblem = { field: string; reason: string };

/**
 * Check the record against what publication requires.
 *
 * Returns problems rather than throwing, so both a test and the running server
 * can ask the same question and the UI can render the honest state.
 */
export function validateLegalEntity(entity: LegalEntity = LEGAL_ENTITY): LegalEntityProblem[] {
  const problems: LegalEntityProblem[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = entity[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      problems.push({ field, reason: "Pflichtangabe fehlt." });
      continue;
    }
    if (PLACEHOLDER_PATTERNS.some((re) => re.test(value))) {
      problems.push({ field, reason: `Platzhalterwert "${value}".` });
    }
  }

  if (entity.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entity.email)) {
    problems.push({ field: "email", reason: "Keine gültige E-Mail-Adresse." });
  }

  // A register court without a number, or the reverse, is an incomplete entry.
  if ((entity.registerCourt === null) !== (entity.registerNumber === null)) {
    problems.push({
      field: "registerCourt",
      reason: "Registergericht und Registernummer müssen gemeinsam angegeben werden.",
    });
  }

  if (entity.disputeResolution.participates && !entity.disputeResolution.body) {
    problems.push({ field: "disputeResolution", reason: "Teilnahme erklärt, aber keine Stelle benannt." });
  }

  return problems;
}

/** True when the record may be published as an imprint. */
export function legalEntityPublishable(entity: LegalEntity = LEGAL_ENTITY): boolean {
  return entity.configured && validateLegalEntity(entity).length === 0;
}

/** Address as it should appear, or null while the record is not publishable. */
export function formattedAddress(entity: LegalEntity = LEGAL_ENTITY): string[] | null {
  if (!legalEntityPublishable(entity)) return null;
  return [entity.name, entity.street, `${entity.postalCode} ${entity.city}`, entity.country];
}

/** Shown in place of the details while they are not available. */
export const LEGAL_ENTITY_PENDING_DE =
  "Die vollständigen Anbieterangaben werden derzeit hinterlegt und sind in Kürze an dieser Stelle abrufbar. Bis dahin erreichen Sie uns unter der angegebenen E-Mail-Adresse.";

// ============================================================================
// READ-ONLY VIEWS — what every other surface is allowed to show
// ============================================================================

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The one public contact mailbox.
 *
 * Shown even before the record is publishable, because it is how a visitor
 * reaches the operator in the meantime (see LEGAL_ENTITY_PENDING_DE). Null if
 * the field does not hold an address, so no surface renders a broken mailto.
 */
export function contactEmail(entity: LegalEntity = LEGAL_ENTITY): string | null {
  const email = entity.email.trim();
  return EMAIL_SHAPE.test(email) ? email : null;
}

/** Registered name, or null while the record is not publishable. */
export function operatorName(entity: LegalEntity = LEGAL_ENTITY): string | null {
  return legalEntityPublishable(entity) ? entity.name : null;
}

/**
 * "City, Country", or null while the record is not publishable.
 *
 * A locality is a claim about where the operator is. A surface that shows one
 * the record does not state is inventing it, so every caller omits the line
 * on null rather than falling back to a plausible city.
 */
export function operatorLocality(entity: LegalEntity = LEGAL_ENTITY): string | null {
  return legalEntityPublishable(entity) ? `${entity.city}, ${entity.country}` : null;
}

/**
 * The consumer dispute-resolution statement, or null while the record is not
 * publishable.
 *
 * `participates: false` is the record's default, not a decision anyone has
 * taken. Declaring "not willing and not obliged" on behalf of an operator who
 * has not yet been named would publish a default as a fact.
 */
export function disputeResolutionStatement(entity: LegalEntity = LEGAL_ENTITY): string | null {
  if (!legalEntityPublishable(entity)) return null;
  const { participates, body } = entity.disputeResolution;
  if (participates && body) {
    return `Der Anbieter nimmt am Streitbeilegungsverfahren vor folgender Stelle teil: ${body}`;
  }
  return "Der Anbieter ist nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.";
}
