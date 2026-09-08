/**
 * shared/edifact.ts
 *
 * UN/EDIFACT syntax, level A — the wire format German market communication
 * still runs on.
 *
 * This is where naive implementations break, and they break in the same place
 * every time: escaping. EDIFACT reserves four characters — component
 * separator, element separator, segment terminator and the release character
 * itself — and any of them may legitimately appear inside a value. A meter
 * point name containing an apostrophe, a partner name containing a plus sign,
 * a free-text field containing a colon: each one silently truncates a message
 * that was assembled by string concatenation, and the receiving system answers
 * days later with a rejection that names no cause.
 *
 * So the rule here is absolute: values NEVER reach the wire without passing
 * through the escaper, and the parser reverses it exactly. The round trip is
 * tested against payloads built specifically out of the reserved characters.
 *
 * Two more integrity rules the format demands and half of the implementations
 * get wrong:
 *
 *   - UNT counts the segments of its own message INCLUDING UNH and UNT.
 *   - UNZ counts the messages in the interchange, and its control reference
 *     must equal the one in UNB.
 *
 * Both are computed here, never supplied by the caller.
 */

// ============================================================================
// SERVICE CHARACTERS
// ============================================================================

export type ServiceCharacters = {
  /** Separates components inside a composite data element. Default ":". */
  component: string;
  /** Separates data elements inside a segment. Default "+". */
  element: string;
  /** Decimal mark. Default "." — note EDIFACT's default is in fact the comma. */
  decimal: string;
  /** Release (escape) character. Default "?". */
  release: string;
  /** Reserved, always a space. */
  reserved: string;
  /** Terminates a segment. Default "'". */
  segment: string;
};

/**
 * The set German market communication uses. The decimal mark is the point,
 * which differs from the EDIFACT default and is exactly the kind of detail
 * that has to be declared rather than assumed.
 */
export const DEFAULT_SERVICE_CHARACTERS: ServiceCharacters = {
  component: ":",
  element: "+",
  decimal: ".",
  release: "?",
  reserved: " ",
  segment: "'",
};

/** The UNA segment that announces the service characters. */
export function serviceStringAdvice(chars: ServiceCharacters = DEFAULT_SERVICE_CHARACTERS): string {
  return `UNA${chars.component}${chars.element}${chars.decimal}${chars.release}${chars.reserved}${chars.segment}`;
}

export class EdifactError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EdifactError";
    this.code = code;
  }
}

// ============================================================================
// ESCAPING
// ============================================================================

/**
 * Escape a value for the wire.
 *
 * The release character is escaped FIRST. Doing it in any other order double-
 * escapes what the earlier passes inserted, and the value comes back wrong.
 */
export function escapeValue(value: string, chars: ServiceCharacters = DEFAULT_SERVICE_CHARACTERS): string {
  let out = "";
  for (const ch of value) {
    if (
      ch === chars.release ||
      ch === chars.component ||
      ch === chars.element ||
      ch === chars.segment
    ) {
      out += chars.release;
    }
    out += ch;
  }
  return out;
}

/** Reverse of escapeValue. A trailing release character is a malformed value. */
export function unescapeValue(value: string, chars: ServiceCharacters = DEFAULT_SERVICE_CHARACTERS): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === chars.release) {
      if (i + 1 >= value.length) {
        throw new EdifactError("dangling_release", "Ein Freigabezeichen steht am Ende des Wertes.");
      }
      out += value[i + 1];
      i++;
      continue;
    }
    out += value[i];
  }
  return out;
}

// ============================================================================
// SEGMENTS
// ============================================================================

/**
 * A segment: a tag and its data elements. An element is either a simple value
 * or a composite — an array of components. Undefined and null components are
 * written as empty, which is how EDIFACT expresses an omitted component.
 */
export type Component = string | number | null | undefined;
export type DataElement = Component | Component[];

export type Segment = {
  tag: string;
  elements: DataElement[];
};

function componentToString(c: Component, chars: ServiceCharacters): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") {
    if (!Number.isFinite(c)) {
      throw new EdifactError("non_finite_number", "Ein nicht endlicher Zahlenwert kann nicht übertragen werden.");
    }
    // The decimal mark is a service character, so it is written, not escaped.
    return String(c).replace(".", chars.decimal);
  }
  return escapeValue(c, chars);
}

/** Serialise one segment, terminator included. */
export function writeSegment(
  segment: Segment,
  chars: ServiceCharacters = DEFAULT_SERVICE_CHARACTERS,
): string {
  if (!/^[A-Z]{3}$/.test(segment.tag)) {
    throw new EdifactError("invalid_tag", `Segmentbezeichner "${segment.tag}" muss aus drei Großbuchstaben bestehen.`);
  }

  const parts = segment.elements.map((el) =>
    Array.isArray(el)
      ? el.map((c) => componentToString(c, chars)).join(chars.component)
      : componentToString(el, chars),
  );

  // Trailing empty elements carry no information and are omitted, which is
  // what receiving systems expect and what keeps messages comparable.
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();

  return [segment.tag, ...parts].join(chars.element) + chars.segment;
}

/**
 * Split a message into segments, honouring the release character.
 *
 * A terminator preceded by an unconsumed release character is data, not a
 * boundary — the single rule a `split("'")` gets wrong.
 */
export function splitSegments(
  message: string,
  chars: ServiceCharacters = DEFAULT_SERVICE_CHARACTERS,
): string[] {
  const segments: string[] = [];
  let current = "";
  let released = false;

  for (const ch of message) {
    if (released) {
      current += ch;
      released = false;
      continue;
    }
    if (ch === chars.release) {
      current += ch;
      released = true;
      continue;
    }
    if (ch === chars.segment) {
      if (current.trim().length > 0) segments.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  if (released) {
    throw new EdifactError("dangling_release", "Die Nachricht endet mit einem Freigabezeichen.");
  }
  if (current.trim().length > 0) {
    throw new EdifactError("unterminated_segment", "Das letzte Segment ist nicht abgeschlossen.");
  }
  return segments;
}

/** Split on a separator, honouring the release character. */
function splitReleased(value: string, separator: string, chars: ServiceCharacters): string[] {
  const out: string[] = [];
  let current = "";
  let released = false;

  for (const ch of value) {
    if (released) {
      current += ch;
      released = false;
      continue;
    }
    if (ch === chars.release) {
      current += ch;
      released = true;
      continue;
    }
    if (ch === separator) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/**
 * Parse one serialised segment back into tag and elements.
 *
 * A trailing terminator is accepted and discarded, so a segment can be handed
 * back exactly as writeSegment produced it. An ESCAPED terminator inside a
 * value is not a boundary and survives — which is why this splits on the
 * terminator rather than trimming the last character.
 */
export function readSegment(
  raw: string,
  chars: ServiceCharacters = DEFAULT_SERVICE_CHARACTERS,
): Segment {
  const body = splitReleased(raw.trim(), chars.segment, chars)[0];
  const parts = splitReleased(body, chars.element, chars);
  const tag = parts.shift() ?? "";
  if (!/^[A-Z]{3}$/.test(tag)) {
    throw new EdifactError("invalid_tag", `Segmentbezeichner "${tag}" ist ungültig.`);
  }
  const elements: DataElement[] = parts.map((p) => {
    const comps = splitReleased(p, chars.component, chars).map((c) => unescapeValue(c, chars));
    return comps.length === 1 ? comps[0] : comps;
  });
  return { tag, elements };
}

/** Parse a whole interchange, detecting a leading UNA and using its characters. */
export function parseInterchange(message: string): {
  chars: ServiceCharacters;
  segments: Segment[];
} {
  let chars = DEFAULT_SERVICE_CHARACTERS;
  let body = message.trim();

  if (body.startsWith("UNA")) {
    if (body.length < 9) {
      throw new EdifactError("invalid_una", "Das UNA-Segment ist unvollständig.");
    }
    chars = {
      component: body[3],
      element: body[4],
      decimal: body[5],
      release: body[6],
      reserved: body[7],
      segment: body[8],
    };
    body = body.slice(9);
  }

  return { chars, segments: splitSegments(body, chars).map((s) => readSegment(s, chars)) };
}

// ============================================================================
// INTERCHANGE ASSEMBLY
// ============================================================================

export type MessageBody = {
  /** Message reference, unique within the interchange. */
  reference: string;
  /** e.g. ["MSCONS", "D", "04B", "UN", "2.4c"] */
  identifier: string[];
  /** Everything between UNH and UNT, in order. */
  segments: Segment[];
};

export type InterchangeHeader = {
  /** Sender identification and qualifier. */
  sender: { id: string; qualifier: string };
  receiver: { id: string; qualifier: string };
  /** Interchange preparation date/time. */
  preparedAt: { date: string; time: string };
  /** Interchange control reference. UNZ must repeat it, and does. */
  controlReference: string;
  /** Application reference, e.g. the message type. */
  applicationReference?: string;
  /** Syntax identifier and version. */
  syntax?: { identifier: string; version: string };
  /** Test indicator. Set for anything not meant to be processed productively. */
  testIndicator?: boolean;
};

/**
 * Assemble a complete interchange.
 *
 * UNT segment counts and the UNZ message count are computed from the actual
 * content. They are the two integrity checks a receiving system runs first,
 * and a caller-supplied count is a caller-supplied bug.
 */
export function buildInterchange(
  header: InterchangeHeader,
  messages: MessageBody[],
  chars: ServiceCharacters = DEFAULT_SERVICE_CHARACTERS,
): string {
  if (messages.length === 0) {
    throw new EdifactError("empty_interchange", "Eine Übertragungsdatei ohne Nachricht ist nicht zulässig.");
  }

  const seen = new Set<string>();
  for (const m of messages) {
    if (seen.has(m.reference)) {
      throw new EdifactError("duplicate_message_reference", `Die Nachrichtenreferenz "${m.reference}" kommt mehrfach vor.`);
    }
    seen.add(m.reference);
  }

  const syntax = header.syntax ?? { identifier: "UNOC", version: "3" };

  const out: string[] = [serviceStringAdvice(chars)];

  out.push(
    writeSegment(
      {
        tag: "UNB",
        elements: [
          [syntax.identifier, syntax.version],
          [header.sender.id, header.sender.qualifier],
          [header.receiver.id, header.receiver.qualifier],
          [header.preparedAt.date, header.preparedAt.time],
          header.controlReference,
          null,
          header.applicationReference ?? null,
          null,
          null,
          null,
          header.testIndicator ? "1" : null,
        ],
      },
      chars,
    ),
  );

  for (const m of messages) {
    const unh: Segment = { tag: "UNH", elements: [m.reference, m.identifier] };
    // UNH + body + UNT.
    const count = m.segments.length + 2;
    const unt: Segment = { tag: "UNT", elements: [String(count), m.reference] };

    out.push(writeSegment(unh, chars));
    for (const s of m.segments) out.push(writeSegment(s, chars));
    out.push(writeSegment(unt, chars));
  }

  out.push(
    writeSegment(
      { tag: "UNZ", elements: [String(messages.length), header.controlReference] },
      chars,
    ),
  );

  return out.join("");
}

// ============================================================================
// INTEGRITY
// ============================================================================

export type IntegrityFinding = { code: string; message: string };

/**
 * Verify an interchange against its own declared counts and references.
 *
 * Deliberately independent of the builder: it reads the produced message and
 * checks the invariants from the outside, so a test — or a receiving system —
 * can establish that a message is well-formed without trusting the code that
 * wrote it.
 */
export function verifyInterchange(message: string): {
  ok: boolean;
  findings: IntegrityFinding[];
  messageCount: number;
} {
  const findings: IntegrityFinding[] = [];
  const { segments } = parseInterchange(message);

  const first = segments[0];
  const last = segments[segments.length - 1];

  if (!first || first.tag !== "UNB") {
    findings.push({ code: "missing_unb", message: "Die Übertragungsdatei beginnt nicht mit UNB." });
  }
  if (!last || last.tag !== "UNZ") {
    findings.push({ code: "missing_unz", message: "Die Übertragungsdatei endet nicht mit UNZ." });
  }

  const flat = (el: DataElement | undefined): string =>
    el === undefined ? "" : Array.isArray(el) ? String(el[0] ?? "") : String(el ?? "");

  let messageCount = 0;
  let open: { reference: string; startIndex: number } | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.tag === "UNH") {
      if (open) {
        findings.push({ code: "nested_unh", message: `UNH ohne vorangehendes UNT bei Segment ${i + 1}.` });
      }
      open = { reference: flat(seg.elements[0]), startIndex: i };
      continue;
    }

    if (seg.tag === "UNT") {
      if (!open) {
        findings.push({ code: "unt_without_unh", message: `UNT ohne UNH bei Segment ${i + 1}.` });
        continue;
      }
      messageCount++;

      const declared = Number(flat(seg.elements[0]));
      const actual = i - open.startIndex + 1;
      if (declared !== actual) {
        findings.push({
          code: "unt_count_mismatch",
          message: `UNT weist ${declared} Segmente aus, tatsächlich sind es ${actual}.`,
        });
      }

      const reference = flat(seg.elements[1]);
      if (reference !== open.reference) {
        findings.push({
          code: "unt_reference_mismatch",
          message: `UNT verweist auf "${reference}", UNH lautet "${open.reference}".`,
        });
      }
      open = null;
    }
  }

  if (open) {
    findings.push({ code: "unclosed_message", message: `Die Nachricht "${open.reference}" ist nicht durch UNT abgeschlossen.` });
  }

  if (first?.tag === "UNB" && last?.tag === "UNZ") {
    const unbRef = flat(first.elements[4]);
    const unzRef = flat(last.elements[1]);
    if (unbRef !== unzRef) {
      findings.push({
        code: "control_reference_mismatch",
        message: `UNZ verweist auf "${unzRef}", UNB lautet "${unbRef}".`,
      });
    }
    const declared = Number(flat(last.elements[0]));
    if (declared !== messageCount) {
      findings.push({
        code: "unz_count_mismatch",
        message: `UNZ weist ${declared} Nachrichten aus, tatsächlich sind es ${messageCount}.`,
      });
    }
  }

  return { ok: findings.length === 0, findings, messageCount };
}
