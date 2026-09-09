/**
 * shared/mcp.ts
 *
 * Model Context Protocol server definition.
 *
 * Search engines decide whether this product gets MENTIONED. This decides
 * whether it gets USED: an agent that speaks MCP can add this server and then
 * call the engines directly as tools — compute a metering concept, compare
 * allocation keys, build an MSCONS message — inside whatever workflow it is
 * already running.
 *
 * That is a different and much stronger position than ranking for a query. A
 * mention is a link somebody may follow; a tool call is the product doing the
 * work, in someone else's session, with the answer coming back stamped.
 *
 * The protocol is JSON-RPC 2.0. It is implemented here directly rather than
 * through an SDK: the surface needed is small, the wire format is stable, and
 * a dependency in the request path of a public endpoint is a dependency whose
 * release cycle becomes ours.
 */

import { z } from "zod";
import {
  AllocationRequestSchema,
  BillingRequestSchema,
  CalculateRequestSchema,
  EligibilityRequestSchema,
  IdentifierCheckRequestSchema,
  MarketGridRequestSchema,
  MesskonzeptRequestSchema,
  MsconsRequestSchema,
} from "./api-contract.js";

/** The revision of the protocol this server implements. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const MCP_SERVER_INFO = {
  name: "energie-teilen",
  title: "Energie Teilen — deterministische Energie-Engines",
  version: "1.0.0",
} as const;

/**
 * Shown to an agent before it decides whether to use this server.
 *
 * It states what the tools do AND what they refuse to do, because an agent
 * that does not know the boundary will present a refusal as a failure or,
 * worse, work around it.
 */
export const MCP_INSTRUCTIONS = `Deterministische Rechenwerkzeuge für dezentrale Energieprojekte in Deutschland: Mieterstrom, gemeinschaftliche Gebäudeversorgung und Energy Sharing.

Alle Ergebnisse stammen aus geprüftem, versioniertem Code — nicht aus einem Sprachmodell. Jede Antwort trägt einen Modellstempel (Modellversion, Annahmensatz, Jurisdiktion, Währung) und die Herkunft jedes Eingabewerts.

Wichtig für die Nutzung:
- Die Werkzeuge VERWEIGERN eine Antwort, wenn eine Eingabe außerhalb dessen liegt, was sie beantworten können. Eine Verweigerung ist ein korrektes Ergebnis, kein Fehler, und nennt den Grund. Sie darf nicht umgangen werden.
- Zeitraster: Das deutsche Viertelstundenraster ist lokal. Zwei Tage im Jahr haben 92 bzw. 100 Viertelstunden, nicht 96. Vor jeder Reihenübergabe das Raster mit market_grid abfragen.
- Rechtliche Zulässigkeit wird NICHT beurteilt. Die Werkzeuge bewerten wirtschaftliche und strukturelle Voraussetzungen. Aussagen zur Zulässigkeit einer Konstellation gehören nicht in eine Antwort, die auf diesen Werkzeugen beruht.
- Geldbeträge kommen in ganzen Cent zurück und sind bereits abgestimmt; sie dürfen nicht neu berechnet werden.

Sprache der Ausgaben: Deutsch.`;

// ============================================================================
// TOOLS
// ============================================================================

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** The v1 route this tool is a thin wrapper over. */
  endpoint: string;
  method: "GET" | "POST";
  /** Read-only tools may be called without confirmation. All of these are. */
  readOnly: true;
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "calculate_economics",
    title: "Wirtschaftlichkeit rechnen",
    description:
      "Berechnet Amortisation, Kapitalwert, internen Zinsfuß, kumulierten Erlös und CO2-Einsparung für eine Mieterstrom-Konstellation, in drei Szenarien (konservativ, realistisch, optimistisch). Ausgelassene Annahmen werden mit dem für DIESE Anlagengröße geltenden regulierten Satz gefüllt; die Antwort weist je Wert aus, ob er vom Aufrufer stammt. Pflichtfeld ist inputs.kwp, weil jede regulierte Rate nach Anlagengröße gebändert ist.",
    inputSchema: CalculateRequestSchema,
    endpoint: "/api/v1/calculate",
    method: "POST",
    readOnly: true,
  },
  {
    name: "assess_eligibility",
    title: "Konstellation qualifizieren",
    description:
      "Beurteilt, ob eine Konstellation die wirtschaftlichen und strukturellen Voraussetzungen erfüllt, und liefert Machbarkeit, Werttreiber, Hauptrisiko, fehlende Angaben und einen Aufwandsband. Trifft ausdrücklich KEINE Aussage über rechtliche Zulässigkeit. Unbekannte Angaben werden als Lücke benannt statt angenommen.",
    inputSchema: EligibilityRequestSchema,
    endpoint: "/api/v1/eligibility",
    method: "POST",
    readOnly: true,
  },
  {
    name: "derive_metering_concept",
    title: "Messkonzept ableiten",
    description:
      "Leitet aus der Konstellation die Messvariante ab (Summenzähler, Einzelzähler oder Viertelstundenbilanzierung), zusammen mit dem vollständigen Zählerinventar samt Anzahl und Anforderung an Zählerstandsgangmessung, den zu besetzenden Marktrollen und der geordneten Aufgabenliste mit kritischem Pfad. Ohne die Angabe constellation.gridConnection lautet das Ergebnis 'not_determinable' — das ist die richtige Antwort und darf nicht durch eine Annahme ersetzt werden.",
    inputSchema: MesskonzeptRequestSchema,
    endpoint: "/api/v1/messkonzept",
    method: "POST",
    readOnly: true,
  },
  {
    name: "allocate_generation",
    title: "Aufteilungsschlüssel rechnen",
    description:
      "Verteilt die Erzeugung viertelstundengenau auf die Teilnehmer, nach einem oder allen drei Schlüsseln (statisch, dynamisch, mit Nachverteilung). Zuordnung plus Einspeisung ergibt in jedem Intervall exakt die Erzeugung, und kein Teilnehmer erhält mehr, als er verbraucht hat. Ohne Angabe von 'key' werden alle drei gerechnet und verglichen, mit der Angabe, welcher wie viel mehr Eigennutzung bringt. Die Länge jeder Verbrauchsreihe muss der Erzeugungsreihe entsprechen.",
    inputSchema: AllocationRequestSchema,
    endpoint: "/api/v1/allocation",
    method: "POST",
    readOnly: true,
  },
  {
    name: "bill_period",
    title: "Abrechnung erstellen",
    description:
      "Erstellt je Teilnehmer eine Abrechnung aus gemessenen Mengen: Positionen, Netto, Umsatzsteuer, Brutto, verrechnete Abschläge und Saldo. Alle Beträge in ganzen Cent; jede Summe ist die Summe der Positionen darüber. Die Antwort enthält eine unabhängige Rekonziliation dieser Identitäten — diese Beträge nicht nachrechnen, sondern übernehmen. Ohne den örtlichen Grundversorgungstarif wird der Vergleich als nicht bestimmbar gemeldet statt geschätzt.",
    inputSchema: BillingRequestSchema,
    endpoint: "/api/v1/billing",
    method: "POST",
    readOnly: true,
  },
  {
    name: "market_grid",
    title: "Viertelstundenraster abfragen",
    description:
      "Liefert die tatsächliche Anzahl der Viertelstunden eines lokalen Tages oder Zeitraums in Europe/Berlin: 96 an einem gewöhnlichen Tag, 92 am letzten Sonntag im März, 100 am letzten Sonntag im Oktober. VOR jeder Übergabe von Intervallreihen aufrufen — eine mit 96 fest verdrahtete Reihe ist an diesen beiden Tagen falsch. Ein volles Jahr ergibt weiterhin 35040, weil sich die Umstellungen aufheben; die Jahressumme beweist deshalb nichts.",
    inputSchema: MarketGridRequestSchema,
    endpoint: "/api/v1/mako/grid",
    method: "GET",
    readOnly: true,
  },
  {
    name: "validate_market_identifiers",
    title: "Marktidentifikatoren prüfen",
    description:
      "Prüft Marktlokations-ID, Messlokations-ID, BDEW-Codenummern und EIC auf Format. Prüfziffernverfahren sind Veröffentlichungen Dritter; solange die Umsetzung nicht gegen die Veröffentlichung geprüft ist, meldet das Werkzeug 'algorithm_unverified' statt 'gültig'. Diese Antwort nicht als Bestätigung der Gültigkeit weitergeben.",
    inputSchema: IdentifierCheckRequestSchema,
    endpoint: "/api/v1/mako/identifiers",
    method: "POST",
    readOnly: true,
  },
  {
    name: "build_mscons_message",
    title: "MSCONS-Nachricht bauen",
    description:
      "Baut aus Viertelstundenwerten eine vollständige MSCONS-Übertragungsdatei (EDIFACT). Segmentzählung und Kontrollreferenzen werden aus dem Inhalt berechnet und in der Antwort aus der erzeugten Nachricht heraus nachgeprüft. Eine Reihe, die nicht zum Raster des Zeitraums passt, wird abgelehnt statt aufgefüllt. Die Syntax ist geprüft; die Segmentverwendung ist NICHT gegen die aktuelle BDEW-Formatbeschreibung abgeglichen, weshalb die Nachricht als Testübertragung gekennzeichnet ist. Nicht als produktionsreif darstellen.",
    inputSchema: MsconsRequestSchema,
    endpoint: "/api/v1/mako/mscons",
    method: "POST",
    readOnly: true,
  },
];

export function toolByName(name: string): McpTool | null {
  return MCP_TOOLS.find((t) => t.name === name) ?? null;
}

// ============================================================================
// JSON-RPC
// ============================================================================

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  /** Absent for a notification, which expects no response. */
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

/** Codes from the JSON-RPC 2.0 specification. */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

export function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  data?: unknown,
) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message, data } };
}

// ============================================================================
// JSON SCHEMA
// ============================================================================

/**
 * Convert a Zod schema to the JSON Schema an MCP client needs.
 *
 * The conversion itself is Zod's own — hand-rolling it means the emitted
 * schema drifts from what the validator actually enforces, and an agent that
 * trusts a wrong schema sends input the tool then refuses. Two things are
 * added on top: `$schema` is dropped (MCP carries the dialect itself), and
 * the result is required to be an object schema, because MCP tool arguments
 * are always a named-argument object.
 */
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, {
    io: "input",
    target: "draft-2020-12",
    unrepresentable: "throw",
  }) as Record<string, unknown>;

  const { $schema: _dialect, ...rest } = converted;
  if (rest.type !== "object") {
    throw new Error(`toJsonSchema: tool arguments must be an object, got "${String(rest.type)}"`);
  }
  return rest;
}

/** The tool list an MCP client receives. */
export function toolListPayload() {
  return {
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: toJsonSchema(t.inputSchema),
      annotations: {
        readOnlyHint: t.readOnly,
        idempotentHint: true,
        openWorldHint: false,
      },
    })),
  };
}
