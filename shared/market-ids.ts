/**
 * shared/market-ids.ts
 *
 * The identifiers German market communication is addressed with.
 *
 * Nothing can be exchanged with a Netzbetreiber, a Messstellenbetreiber or a
 * Bilanzkreisverantwortlichen without them: the Marktlokation and Messlokation
 * being reported on, the BDEW code numbers of sender and receiver, and the EIC
 * of the balancing area. A message with a malformed identifier is rejected
 * downstream, days later, by a system that answers with an error code and no
 * explanation — so they are validated here, before anything is sent.
 *
 * Two classes of rule, kept apart on purpose:
 *
 *   - FORMAT rules (length, character set) are self-evident from the value and
 *     are asserted plainly.
 *   - CHECK-DIGIT algorithms are specifications published by a third party.
 *     Each one is registered with its own `verified` flag, and a validator
 *     never reports a check digit as correct while its algorithm is unverified
 *     — it reports `algorithm_unverified` instead. The same gate the statutory
 *     citations use: an unchecked rule does not get to sound authoritative.
 */

// ============================================================================
// ALGORITHM REGISTER
// ============================================================================

export type CheckDigitAlgorithm = {
  id: string;
  name: string;
  /** What it is applied to. */
  appliesTo: string;
  /** Has the implementation been checked against the published specification? */
  verified: boolean;
  /** Where it was checked. MUST be non-null when verified is true. */
  reference: string | null;
  /** ISO date it was checked. MUST be non-null when verified is true. */
  asOf: string | null;
  openQuestion?: string;
};

export const CHECK_DIGIT_ALGORITHMS: Record<string, CheckDigitAlgorithm> = {
  malo: {
    id: "malo",
    name: "Prüfziffer der Marktlokations-ID",
    appliesTo: "MaLo-ID, 11 Stellen",
    verified: false,
    reference: null,
    asOf: null,
    openQuestion:
      "Die Gewichtung ist nicht gegen die aktuelle Veröffentlichung des BDEW geprüft. Bis dahin wird die Prüfziffer berechnet, aber nicht als bestätigt ausgewiesen.",
  },
  ean13: {
    id: "ean13",
    name: "Prüfziffer nach EAN-13 / GS1",
    appliesTo: "BDEW-Codenummer, 13 Stellen",
    verified: false,
    reference: null,
    asOf: null,
    openQuestion:
      "Der Algorithmus ist der allgemein bekannte EAN-13-Modulo-10; die Anwendung auf BDEW-Codenummern ist nicht gegen die Veröffentlichung geprüft.",
  },
  eic: {
    id: "eic",
    name: "Prüfzeichen des Energy Identification Code",
    appliesTo: "EIC, 16 Stellen",
    verified: false,
    reference: null,
    asOf: null,
    openQuestion:
      "Die Umsetzung folgt dem veröffentlichten ENTSO-E-Verfahren, ist aber nicht gegen die aktuelle Fassung des EIC-Referenzhandbuchs geprüft.",
  },
};

export type CheckDigitStatus = "ok" | "mismatch" | "algorithm_unverified";

/**
 * Report a computed check digit only when its algorithm has been verified.
 *
 * This is the gate. Without it, an unchecked weighting would silently become a
 * claim that an identifier is valid.
 */
function gate(algorithmId: string, matches: boolean): CheckDigitStatus {
  const algo = CHECK_DIGIT_ALGORITHMS[algorithmId];
  if (!algo || !algo.verified) return "algorithm_unverified";
  return matches ? "ok" : "mismatch";
}

export type IdValidation = {
  value: string;
  /** Length and character set — asserted, because they need no third party. */
  format: "ok" | "invalid";
  checkDigit: CheckDigitStatus;
  /** The digit or character the algorithm computed, whether or not it is trusted. */
  computed: string | null;
  problems: string[];
};

// ============================================================================
// MARKTLOKATIONS-ID (MaLo)
// ============================================================================

export const MALO_LENGTH = 11;

/** Modulo-10 over the first ten digits, even positions weighted double. */
export function deriveMaloCheckDigit(first10: string): string {
  if (!/^\d{10}$/.test(first10)) {
    throw new Error("Für die Prüfziffer werden genau zehn Ziffern benötigt.");
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = first10.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? digit : digit * 2;
  }
  return String((10 - (sum % 10)) % 10);
}

export function validateMalo(value: string): IdValidation {
  const problems: string[] = [];
  const trimmed = value.trim();

  if (!/^\d{11}$/.test(trimmed)) {
    problems.push(`Eine MaLo-ID besteht aus genau ${MALO_LENGTH} Ziffern.`);
    return { value: trimmed, format: "invalid", checkDigit: "algorithm_unverified", computed: null, problems };
  }
  if (trimmed.startsWith("0")) {
    problems.push("Eine MaLo-ID beginnt nicht mit einer Null.");
  }

  const computed = deriveMaloCheckDigit(trimmed.slice(0, 10));
  const status = gate("malo", computed === trimmed[10]);
  if (status === "mismatch") problems.push("Die Prüfziffer stimmt nicht.");

  return {
    value: trimmed,
    format: problems.length === 0 ? "ok" : "invalid",
    checkDigit: status,
    computed,
    problems,
  };
}

// ============================================================================
// MESSLOKATIONS-ID (MeLo) — the Zählpunktbezeichnung
// ============================================================================

export const MELO_LENGTH = 33;

/**
 * Structure is asserted only as far as it is self-evident: 33 uppercase
 * alphanumerics beginning with a two-letter country code. The internal split
 * is documented but not enforced, because enforcing an unverified layout would
 * reject valid identifiers.
 */
export function validateMelo(value: string): IdValidation {
  const problems: string[] = [];
  const trimmed = value.trim().toUpperCase();

  if (trimmed.length !== MELO_LENGTH) {
    problems.push(`Eine MeLo-ID (Zählpunktbezeichnung) hat genau ${MELO_LENGTH} Stellen, hier ${trimmed.length}.`);
  }
  if (!/^[0-9A-Z]*$/.test(trimmed)) {
    problems.push("Eine MeLo-ID enthält ausschließlich Ziffern und Großbuchstaben.");
  }
  if (!/^[A-Z]{2}/.test(trimmed)) {
    problems.push("Eine MeLo-ID beginnt mit einem zweistelligen Ländercode.");
  }

  return {
    value: trimmed,
    format: problems.length === 0 ? "ok" : "invalid",
    // There is no check digit in this identifier.
    checkDigit: "algorithm_unverified",
    computed: null,
    problems,
  };
}

// ============================================================================
// BDEW-CODENUMMER
// ============================================================================

export const BDEW_CODE_LENGTH = 13;

/** EAN-13 modulo 10: positions weighted 1 and 3 alternately from the left. */
export function deriveEan13CheckDigit(first12: string): string {
  if (!/^\d{12}$/.test(first12)) {
    throw new Error("Für die Prüfziffer werden genau zwölf Ziffern benötigt.");
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (first12.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export function validateBdewCode(value: string): IdValidation {
  const problems: string[] = [];
  const trimmed = value.trim();

  if (!/^\d{13}$/.test(trimmed)) {
    problems.push(`Eine BDEW-Codenummer besteht aus genau ${BDEW_CODE_LENGTH} Ziffern.`);
    return { value: trimmed, format: "invalid", checkDigit: "algorithm_unverified", computed: null, problems };
  }

  const computed = deriveEan13CheckDigit(trimmed.slice(0, 12));
  const status = gate("ean13", computed === trimmed[12]);
  if (status === "mismatch") problems.push("Die Prüfziffer stimmt nicht.");

  return { value: trimmed, format: problems.length === 0 ? "ok" : "invalid", checkDigit: status, computed, problems };
}

// ============================================================================
// EIC — Energy Identification Code
// ============================================================================

export const EIC_LENGTH = 16;
const EIC_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-";

/**
 * Check character over the first fifteen positions, weights 16 down to 2,
 * modulo 37 across the code's own alphabet.
 */
export function deriveEicCheckCharacter(first15: string): string {
  if (first15.length !== 15) {
    throw new Error("Für das Prüfzeichen werden genau fünfzehn Stellen benötigt.");
  }
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const v = EIC_ALPHABET.indexOf(first15[i]);
    if (v < 0) throw new Error(`Zeichen "${first15[i]}" gehört nicht zum EIC-Zeichenvorrat.`);
    sum += v * (16 - i);
  }
  const check = 36 - ((sum - 1) % 37);
  // 36 maps to "-", which the scheme does not permit as a check character:
  // such a code has to be reissued rather than corrected.
  return check === 36 ? "" : EIC_ALPHABET[check];
}

export function validateEic(value: string): IdValidation {
  const problems: string[] = [];
  const trimmed = value.trim().toUpperCase();

  if (trimmed.length !== EIC_LENGTH) {
    problems.push(`Ein EIC hat genau ${EIC_LENGTH} Stellen, hier ${trimmed.length}.`);
    return { value: trimmed, format: "invalid", checkDigit: "algorithm_unverified", computed: null, problems };
  }
  for (const ch of trimmed) {
    if (EIC_ALPHABET.indexOf(ch) < 0) {
      problems.push(`Das Zeichen "${ch}" gehört nicht zum EIC-Zeichenvorrat.`);
      return { value: trimmed, format: "invalid", checkDigit: "algorithm_unverified", computed: null, problems };
    }
  }

  const computed = deriveEicCheckCharacter(trimmed.slice(0, 15));
  if (computed === "") {
    problems.push("Für diese Zeichenfolge ergibt sich kein zulässiges Prüfzeichen; der Code muss neu vergeben werden.");
  }
  const status = gate("eic", computed !== "" && computed === trimmed[15]);
  if (status === "mismatch") problems.push("Das Prüfzeichen stimmt nicht.");

  return {
    value: trimmed,
    format: problems.length === 0 ? "ok" : "invalid",
    checkDigit: status,
    computed: computed === "" ? null : computed,
    problems,
  };
}

// ============================================================================
// PARTNER
// ============================================================================

export type MarketPartner = {
  /** BDEW code number used to address this partner. */
  code: string;
  name: string;
  /** Role in the message, e.g. "MS" sender, "MR" receiver. */
  role: string;
};

/** Every identifier in one message, checked together. */
export function validateMessageIdentifiers(input: {
  senderCode: string;
  receiverCode: string;
  malo?: string;
  melo?: string;
  balancingAreaEic?: string;
}): { ok: boolean; results: Record<string, IdValidation>; problems: string[] } {
  const results: Record<string, IdValidation> = {
    senderCode: validateBdewCode(input.senderCode),
    receiverCode: validateBdewCode(input.receiverCode),
  };
  if (input.malo !== undefined) results.malo = validateMalo(input.malo);
  if (input.melo !== undefined) results.melo = validateMelo(input.melo);
  if (input.balancingAreaEic !== undefined) {
    results.balancingAreaEic = validateEic(input.balancingAreaEic);
  }

  const problems: string[] = [];
  for (const [field, r] of Object.entries(results)) {
    for (const p of r.problems) problems.push(`${field}: ${p}`);
  }

  return { ok: problems.length === 0, results, problems };
}
