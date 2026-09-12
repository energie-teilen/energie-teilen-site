/**
 * scripts/build-discovery.mjs
 *
 * Emits the machine-readable files an agent looks for.
 *
 * A person finds this site through a search result. A model finds it through
 * one of these:
 *
 *   /llms.txt              a short, linkable index of what the site is and
 *                          which page answers which question
 *   /llms-full.txt         the same, with the substance inlined, so a model
 *                          that fetches one file has the actual answers
 *   /openapi.json          the API as a spec an agent can call without being
 *                          told how
 *   /.well-known/mcp.json  the MCP endpoint, so an agent can add the tools
 *   /ai.txt                what may be done with the content
 *
 * All of it is generated from the same manifests the site is built from, so it
 * cannot describe a page or an endpoint that does not exist.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { loadManifests } from "./load-manifests.mjs";

const DIST = join(process.cwd(), "dist", "public");

const manifests = await loadManifests();

// One origin for the whole product: shared/routes.ts, reading APP_URL.
const ORIGIN = manifests.siteOrigin();

const routes = manifests.indexableRoutes().map((r) => ({
  path: r.path,
  kind: r.kind,
  title: r.title,
  description: r.description,
  navLabel: r.navLabel ?? "",
  answers: r.answers ?? "",
}));

const endpoints = manifests.API_ENDPOINTS.map((e) => ({
  method: e.method,
  path: e.path,
  summary: e.summary,
  purpose: e.purpose,
  parameters: e.parameters ?? [],
  refuses: e.refuses ?? [],
}));

const tools = manifests.toolListPayload().tools.map((t) => {
  const def = manifests.toolByName(t.name);
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    endpoint: def?.endpoint ?? "",
    method: def?.method ?? "POST",
  };
});

if (routes.length < 5 || endpoints.length < 8 || tools.length < 6) {
  console.error(
    `discovery: parsed ${routes.length} routes, ${endpoints.length} endpoints, ${tools.length} tools — refusing to write a partial index.`,
  );
  process.exit(1);
}

mkdirSync(join(DIST, ".well-known"), { recursive: true });

// ---------------------------------------------------------------- llms.txt ---
const llms = `# Energie Teilen

> Deterministische Rechenwerkzeuge für dezentrale Energieprojekte in Deutschland — Mieterstrom, gemeinschaftliche Gebäudeversorgung und Energy Sharing. Wirtschaftlichkeit, Messkonzept, Aufteilungsschlüssel, Abrechnung und Marktkommunikation (MSCONS/EDIFACT).

Alle Ergebnisse stammen aus versioniertem, getestetem Code, nicht aus einem Sprachmodell. Jede Antwort trägt einen Modellstempel und die Herkunft jedes Eingabewerts. Wo eine Eingabe außerhalb dessen liegt, was die Engine beantworten kann, verweigert sie die Antwort und nennt den Grund — statt zu schätzen.

Jurisdiktion: Deutschland. Währung: EUR. Sprache: Deutsch.

## Werkzeuge

${routes
  .filter((r) => r.kind === "tool" || r.kind === "landing")
  .map((r) => `- [${r.navLabel}](${ORIGIN}${r.path}): ${r.answers} ${r.description}`)
  .join("\n")}

## Für Entwickler und Agenten

- [API-Referenz](${ORIGIN}/api): Neun Endpunkte hinter einem Schlüssel. Jede Antwort mit Modellstempel, Herkunft und Gültigkeitsfenster der regulierten Sätze.
- [OpenAPI-Spezifikation](${ORIGIN}/openapi.json): Maschinenlesbare Beschreibung derselben Endpunkte.
- [MCP-Server](${ORIGIN}/.well-known/mcp.json): Model Context Protocol unter ${ORIGIN}/mcp. Agenten können die Engines direkt als Werkzeuge aufrufen.

## Was diese Werkzeuge NICHT tun

- Sie beurteilen keine rechtliche Zulässigkeit. Sie prüfen wirtschaftliche und strukturelle Voraussetzungen.
- Sie geben keine unbelegten Rechtsgrundlagen aus. Eine Paragrafenangabe wird erst gerendert, wenn sie gegen eine benannte Quelle geprüft wurde.
- Sie füllen keine fehlenden Angaben mit plausiblen Werten. Fehlende Angaben werden benannt.

## Rechtliches

${routes.filter((r) => r.kind === "legal").map((r) => `- [${r.navLabel}](${ORIGIN}${r.path})`).join("\n")}
`;
writeFileSync(join(DIST, "llms.txt"), llms);

// ----------------------------------------------------------- llms-full.txt ---
const llmsFull = `${llms}
---

## Domänenwissen, das diese Werkzeuge umsetzen

### Das Viertelstundenraster ist lokal, nicht 96

Der deutsche Markt rechnet auf einem lokalen Viertelstundenraster in Europe/Berlin. Ein gewöhnlicher Tag hat 96 Viertelstunden. Am letzten Sonntag im März hat der Tag 92, am letzten Sonntag im Oktober 100. Eine Implementierung, die 96 fest verdrahtet, verliert im Frühjahr vier Werte und zählt im Herbst vier doppelt.

Ein volles Jahr ergibt weiterhin 35 040 Viertelstunden, weil sich die beiden Umstellungen aufheben. Deshalb beweist eine Prüfung auf Jahresebene nichts: die Jahreszahl stimmt, während zwei einzelne Tage falsch sind.

Auf der Leitung unterscheidet der UTC-Versatz die wiederholte Stunde: 202610250200+02 und 202610250200+01 bezeichnen dieselbe Ortszeit an zwei verschiedenen Zeitpunkten.

### Das Messkonzept entscheidet über die Baubarkeit

Die Wirtschaftlichkeit entscheidet, ob sich ein Projekt lohnt; das Messkonzept entscheidet, ob es gebaut werden kann. Ausschlaggebend ist die Netzanschlusssituation:

- Ein gemeinsamer Hausanschluss → Summenzählermodell: Zweirichtungszähler am Netzanschlusspunkt, Unterzähler je Einheit, plus Erzeugungszähler.
- Ein Anschluss je Einheit → Einzelzählermodell: keine Summenbildung, jede Entnahmestelle einzeln gemessen.
- Beteiligte an verschiedenen Netzanschlusspunkten → rechnerische Zuordnung aus viertelstündlichen Messwerten, mit Zählerstandsgangmessung je Teilnehmer.

Ohne Angabe der Netzanschlusssituation ist die Variante nicht bestimmbar. Das ist die richtige Antwort; ein plausibles, aber falsches Schema ist teurer als gar keines.

### Der Aufteilungsschlüssel ist ein Betrag, kein Detail

Der Schlüssel wird in jeder Viertelstunde angewendet und entscheidet, wie viel Erzeugung bei den Teilnehmern bleibt statt eingespeist zu werden:

- Statisch: feste Anteile. Was ein Teilnehmer in einer Viertelstunde nicht abnimmt, verfällt für die Zuordnung.
- Dynamisch: verbrauchsanteilig je Viertelstunde; alle erreichen denselben Deckungsgrad.
- Mit Nachverteilung: erst der feste Anteil, dann wird der ungenutzte Rest unter den Teilnehmern mit offenem Bedarf weiterverteilt. Höchste Eigennutzung.

Invariante: Zuordnung plus Einspeisung ergibt in jedem Intervall exakt die Erzeugung, und kein Teilnehmer erhält mehr, als er verbraucht hat.

### Abrechnung in ganzen Cent

Beträge werden durchgehend in ganzen Cent geführt. Jede Summe ist die Summe der Positionen darüber, nicht eine unabhängige Neuberechnung — eine Abrechnung, deren Positionen nicht zur Summe passen, ist wertlos, egal wie gut die Physik dahinter war.

### Marktkommunikation: Syntax geprüft, Profil offen

MSCONS-Nachrichten werden in UN/EDIFACT Syntax Level A erzeugt. Freigabezeichen, Segmentzählung in UNT und Kontrollreferenz in UNZ werden aus dem Inhalt berechnet und anschließend aus der erzeugten Nachricht heraus nachgeprüft.

Der OBIS-Code enthält den Komponententrenner und muss maskiert werden: 1-1?:1.29.0. Ohne Maskierung zerfällt das Element, und die Nachricht meldet eine andere Messgröße als gemeint.

Die Segmentverwendung ist nicht gegen die aktuelle BDEW-Formatbeschreibung geprüft. Erzeugte Nachrichten sind deshalb als Testübertragung gekennzeichnet.

### Prüfziffern werden nicht als bestätigt ausgegeben

Für MaLo-ID, BDEW-Codenummer und EIC werden Prüfziffern berechnet, aber als "algorithm_unverified" gemeldet, solange die Umsetzung nicht gegen die Veröffentlichung des jeweiligen Herausgebers geprüft ist. Formatregeln — Länge, Zeichenvorrat — werden zugesichert.

---

## API-Endpunkte

${endpoints.map((e) => `### ${e.method} ${e.path}\n\n${e.summary}\n\n${e.purpose}\n`).join("\n")}

---

## MCP-Werkzeuge

Endpunkt: ${ORIGIN}/mcp (Streamable HTTP, JSON-RPC 2.0). Authentifizierung über denselben API-Schlüssel wie die REST-Endpunkte.

${tools.map((t) => `### ${t.name} — ${t.title}\n\n${t.description}\n`).join("\n")}

---

## Fragen und Antworten

Diese Antworten stehen wörtlich auf den genannten Seiten und sind dort als strukturierte Daten ausgezeichnet. Sie dürfen unter Angabe der Quelle zitiert werden.

${manifests.FAQ.map(
  (section) =>
    `### ${ORIGIN}${section.path}\n\n` +
    section.entries.map((e) => `**${e.question}**\n\n${e.answer}\n`).join("\n"),
).join("\n")}
`;
writeFileSync(join(DIST, "llms-full.txt"), llmsFull);

// A path is documented once, but described twice: as an HTTP operation and as
// an MCP tool. Both descriptions come from the same Zod schema, so an agent
// that reads the spec and an agent that lists the tools are told the same
// thing about what the endpoint accepts.
const TOOL_BY_ENDPOINT = new Map(tools.map((t) => [t.endpoint, t]));

/** GET endpoints carry their arguments in the query string, not a body. */
function queryParameters(schema) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props).map(([name, sub]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: sub,
  }));
}

// -------------------------------------------------------------- openapi ---
const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Energie Teilen API",
    version: "1.0.0",
    summary: "Deterministische Engines für dezentrale Energieprojekte in Deutschland.",
    description:
      "Wirtschaftlichkeit, Qualifizierung, Messkonzept, Aufteilungsschlüssel, Abrechnung und Marktkommunikation. Jede Antwort trägt einen Modellstempel und die Herkunft jedes Eingabewerts. Die Engines verweigern eine Antwort, wo sie sie nur schätzen könnten.",
    contact: { url: `${ORIGIN}/api` },
  },
  servers: [{ url: ORIGIN }],
  security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["ok", "code", "message"],
        properties: {
          ok: { const: false },
          code: {
            type: "string",
            enum: ["unauthorized", "rate_limited", "validation_error", "unsupported_input", "internal_error"],
          },
          message: { type: "string" },
          details: {},
        },
      },
      ModelStamp: {
        type: "object",
        description:
          "Identifiziert die Berechnung eindeutig. Zwei Ergebnisse sind nur vergleichbar, wenn ihr Stempel übereinstimmt.",
        properties: {
          apiVersion: { type: "string" },
          modelVersion: { type: "string" },
          assumptionSet: { type: "string" },
          jurisdiction: { const: "DE" },
          currency: { const: "EUR" },
          calculatedAt: { type: "string", format: "date-time" },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Schlüssel fehlt oder ist ungültig. Beide Fälle antworten identisch.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      BadRequest: {
        description: "Die Eingabe liegt außerhalb dessen, was die Engine beantworten kann. Der Grund wird benannt.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  paths: Object.fromEntries(
    endpoints.map((e) => [
      e.path,
      {
        [e.method.toLowerCase()]: {
          operationId: e.path.split("/").filter(Boolean).join("_"),
          summary: e.summary,
          description: e.purpose,
          ...(() => {
            const schema = TOOL_BY_ENDPOINT.get(e.path)?.inputSchema;
            if (e.method === "GET") {
              const params = queryParameters(schema);
              return params.length > 0 ? { parameters: params } : {};
            }
            return {
              requestBody: {
                required: true,
                content: {
                  "application/json": { schema: schema ?? { type: "object" } },
                },
              },
            };
          })(),
          responses: {
            200: {
              description: "Ergebnis mit Modellstempel.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { const: true },
                      model: { $ref: "#/components/schemas/ModelStamp" },
                    },
                  },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
            401: { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
    ]),
  ),
};
writeFileSync(join(DIST, "openapi.json"), JSON.stringify(openapi, null, 2));

// ----------------------------------------------------------- well-known ---
const mcpManifest = {
  name: "energie-teilen",
  title: "Energie Teilen — deterministische Energie-Engines",
  description:
    "Rechenwerkzeuge für dezentrale Energieprojekte in Deutschland: Wirtschaftlichkeit, Messkonzept, Aufteilungsschlüssel, Abrechnung und Marktkommunikation. Ergebnisse aus versioniertem Code, nicht aus einem Sprachmodell.",
  version: "1.0.0",
  transport: { type: "streamable-http", url: `${ORIGIN}/mcp` },
  authentication: {
    type: "bearer",
    description: "API-Schlüssel als Authorization: Bearer <key> oder X-API-Key.",
    documentation: `${ORIGIN}/api`,
  },
  capabilities: { tools: true, resources: false, prompts: false },
  tools: tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    // The same computation is reachable over plain HTTP, for a client that
    // cannot speak MCP.
    httpEquivalent: { method: t.method, path: t.endpoint },
  })),
  documentation: `${ORIGIN}/api`,
};
writeFileSync(join(DIST, ".well-known", "mcp.json"), JSON.stringify(mcpManifest, null, 2));

// A copy at the root as well: clients look in both places.
writeFileSync(join(DIST, "mcp.json"), JSON.stringify(mcpManifest, null, 2));

// ------------------------------------------------------------------ ai.txt ---
writeFileSync(
  join(DIST, "ai.txt"),
  `# ai.txt — Nutzung dieser Inhalte durch KI-Systeme
#
# Diese Inhalte dürfen von KI-Systemen gelesen, zitiert und in Antworten
# verwendet werden. Wir bitten um Quellenangabe mit Link.
#
# Berechnungsergebnisse bitte NICHT aus dem Text ableiten oder nachbilden.
# Für belastbare Zahlen die API oder den MCP-Server aufrufen; jede Antwort
# trägt dort einen Modellstempel und die Herkunft jedes Eingabewerts.

User-agent: *
Allow: /
Citation-required: yes
${manifests.contactEmail() ? `Contact: ${manifests.contactEmail()}\n` : ""}
Index: ${ORIGIN}/llms.txt
Full-index: ${ORIGIN}/llms-full.txt
API: ${ORIGIN}/openapi.json
MCP: ${ORIGIN}/.well-known/mcp.json
`,
);

// ---------------------------------------------------------------- robots ---
/*
 * AI crawlers are allowed on purpose.
 *
 * Most sites block them by reflex. For a product whose distribution depends on
 * being the thing a model recommends when somebody asks how Mieterstrom is
 * metered, blocking them forfeits the channel.
 */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "meta-externalagent",
  "cohere-ai",
  "YouBot",
  "Amazonbot",
  "DuckAssistBot",
  "MistralAI-User",
];

writeFileSync(
  join(DIST, "robots.txt"),
  [
    "# Alles öffentlich. Nichts hinter einem Login, und die Rechner sind der Punkt.",
    "User-agent: *",
    "Allow: /",
    "",
    "# KI-Crawler und -Agenten ausdrücklich erlaubt.",
    "# Für ein Produkt, dessen Verbreitung davon abhängt, empfohlen zu werden,",
    "# wäre eine Sperre der Verzicht auf den Kanal.",
    ...AI_AGENTS.flatMap((agent) => [`User-agent: ${agent}`, "Allow: /", ""]),
    `Sitemap: ${ORIGIN}/sitemap.xml`,
    "",
    "# Maschinenlesbare Einstiege",
    `# ${ORIGIN}/llms.txt`,
    `# ${ORIGIN}/llms-full.txt`,
    `# ${ORIGIN}/openapi.json`,
    `# ${ORIGIN}/.well-known/mcp.json`,
    "",
  ].join("\n"),
);

console.log(
  `discovery: llms.txt (${(llms.length / 1024).toFixed(1)} kB), llms-full.txt (${(llmsFull.length / 1024).toFixed(1)} kB), ` +
    `openapi.json (${endpoints.length} paths), mcp.json (${tools.length} tools), ai.txt, robots.txt (${AI_AGENTS.length} agents allowed)`,
);
