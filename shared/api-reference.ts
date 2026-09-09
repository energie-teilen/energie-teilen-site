/**
 * shared/api-reference.ts
 *
 * The public description of the v1 API.
 *
 * Written here rather than in the page that renders it, so the documentation
 * and the server read from the same module for paths and version, and a test
 * can check that every documented endpoint is actually mounted and that every
 * mounted endpoint is documented. Undocumented endpoints are the reason APIs
 * get evaluated and then abandoned.
 */

import { API_PREFIX, API_VERSION, MAKO_PREFIX } from "./api-contract.js";

export type ApiParameter = {
  name: string;
  type: string;
  required: boolean;
  description: string;
};

export type ApiEndpointDoc = {
  method: "GET" | "POST";
  path: string;
  summary: string;
  /** What problem this solves, in the reader's terms. */
  purpose: string;
  parameters: ApiParameter[];
  /** A request body or query that actually works. */
  example: string;
  /** An abbreviated but real response shape. */
  responseExample: string;
  /** What it refuses to do, and with which code. */
  refuses: { code: string; when: string }[];
};

export const API_BASE_URL_PLACEHOLDER = "https://<host>";

export const API_AUTH_DOC = {
  summary: "Bearer-Token oder X-API-Key",
  description:
    "Jede Anfrage trägt einen Schlüssel, entweder als Authorization: Bearer <key> oder als X-API-Key. Schlüssel werden ausschließlich als SHA-256-Hash konfiguriert; der Klartext wird einmal ausgegeben und nirgends gespeichert. Ein falscher und ein fehlender Schlüssel werden identisch beantwortet, damit die Antwort nicht verrät, ob ein Schlüssel existiert.",
  example: `curl -H "Authorization: Bearer et_..." \\
  ${API_BASE_URL_PLACEHOLDER}${API_PREFIX}/meta`,
};

export const API_GUARANTEES = [
  {
    title: "Modellstempel auf jeder Antwort",
    body: "Modellversion, Annahmensatz, Jurisdiktion, Währung und Berechnungszeitpunkt. Zwei Ergebnisse sind nur dann vergleichbar, wenn ihr Stempel übereinstimmt — und das lässt sich damit feststellen statt vermuten.",
  },
  {
    title: "Herkunft je Eingabewert",
    body: "Für jede Annahme wird ausgewiesen, ob sie vom Aufrufer stammt oder ein Vorgabewert ist, welche Quellenklasse sie hat und ob sie verifiziert ist. Damit lässt sich einem Eigentümer oder einer Bank zeigen, woher jede Zahl kommt.",
  },
  {
    title: "Gültigkeit der regulierten Sätze",
    body: "Jeder verwendete Satz trägt sein Gültigkeitsfenster. Läuft er aus, sagt die Antwort das, bevor jemand mit einer veralteten Zahl rechnet.",
  },
  {
    title: "Verweigerung statt Schätzung",
    body: "Liegt eine Eingabe außerhalb dessen, was die Engine beantworten kann, kommt ein Fehler mit benanntem Grund — nie ein plausibler Wert. Eine 96-Werte-Reihe für einen Tag mit 100 Viertelstunden wird abgelehnt, nicht aufgefüllt.",
  },
  {
    title: "Nichts wird gespeichert",
    body: "Die Berechnungsendpunkte legen keine übergebenen Projektdaten ab. Eine mitgegebene Referenz wird lediglich zurückgegeben, damit der Aufrufer zuordnen kann.",
  },
];

const MELO_EXAMPLE = "DE0000000000000000000000012345A";

export const API_ENDPOINTS: ApiEndpointDoc[] = [
  {
    method: "GET",
    path: `${API_PREFIX}/meta`,
    summary: "Was diese Installation rechnet und wie aktuell sie ist",
    purpose:
      "Der erste Aufruf einer Integration. Nennt alle Endpunkte, jede regulierte Rate mit Bändern, Rechtsgrundlage und Gültigkeitsfenster, sowie die drei Beteiligungsmodelle mit der Angabe, welches die Engine tatsächlich rechnet.",
    parameters: [],
    example: `curl -H "Authorization: Bearer $KEY" \\
  ${API_BASE_URL_PLACEHOLDER}${API_PREFIX}/meta`,
    responseExample: `{
  "ok": true,
  "model": {
    "apiVersion": "${API_VERSION}",
    "modelVersion": "1.0.0",
    "assumptionSet": "de-mieterstrom-2026-09.2",
    "jurisdiction": "DE",
    "currency": "EUR"
  },
  "rates": { "feedInTariff": { "bands": [...], "freshness": { "status": "current" } } },
  "endpoints": ["${API_PREFIX}/meta", "..."]
}`,
    refuses: [{ code: "401 unauthorized", when: "Schlüssel fehlt oder ist ungültig" }],
  },
  {
    method: "POST",
    path: `${API_PREFIX}/calculate`,
    summary: "Wirtschaftlichkeit in drei Szenarien",
    purpose:
      "Amortisation, Kapitalwert, interner Zinsfuß, kumulierter Erlös und CO2 — konservativ, realistisch und optimistisch parallel. Ausgelassene Eingaben werden mit dem für diese Anlagengröße geltenden Satz gefüllt, und die Herkunft weist aus, welche das waren.",
    parameters: [
      { name: "inputs.kwp", type: "number", required: true, description: "Anlagengröße. Pflicht, weil jede regulierte Rate danach gebändert ist." },
      { name: "inputs.*", type: "number", required: false, description: "Jede weitere Annahme; ausgelassene werden mit dem Vorgabewert gefüllt." },
      { name: "includeSchedule", type: "boolean", required: false, description: "Jahresweise Zahlungsreihe mitliefern." },
      { name: "reference", type: "string", required: false, description: "Eigene Vorgangsnummer, wird zurückgegeben. Nicht gespeichert." },
    ],
    example: `curl -X POST -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"inputs":{"kwp":60,"anzahlWohneinheiten":24},"includeSchedule":true}' \\
  ${API_BASE_URL_PLACEHOLDER}${API_PREFIX}/calculate`,
    responseExample: `{
  "ok": true,
  "scenarios": {
    "realistisch": { "npvEur": 19463.26, "irrPct": 8.94, "amortisationsdauerJahre": 9.8 }
  },
  "provenance": [ { "key": "kwp", "value": 60, "source": "customer", "verified": false } ],
  "freshness": { "feedInTariff": { "status": "current", "daysRemaining": 145 } },
  "warnings": [ { "code": "feed_in_regime_change", "message": "..." } ]
}`,
    refuses: [
      { code: "400 validation_error", when: "kwp fehlt oder liegt außerhalb des zulässigen Bereichs" },
    ],
  },
  {
    method: "POST",
    path: `${API_PREFIX}/eligibility`,
    summary: "Qualifizierung einer Konstellation",
    purpose:
      "Ein Urteil mit Begründung: Machbarkeit, Werttreiber, Hauptrisiko, fehlende Daten, Aufwandsband und der nächste sinnvolle Schritt. Trifft ausdrücklich keine Aussage zur rechtlichen Zulässigkeit.",
    parameters: [
      { name: "inputs.kwp", type: "number", required: true, description: "Anlagengröße." },
      { name: "facts", type: "object", required: false, description: "Eigentümerkonstellation, räumlicher Zuschnitt, Anlagenstatus, Zählerkonzept. Jede Angabe optional; Unbekanntes wird als Lücke benannt statt angenommen." },
    ],
    example: `curl -X POST -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"inputs":{"kwp":60},"facts":{"ownerConstellation":"weg"}}' \\
  ${API_BASE_URL_PLACEHOLDER}${API_PREFIX}/eligibility`,
    responseExample: `{
  "ok": true,
  "verdict": "REQUIRES_REVIEW",
  "findings": [ { "code": "weg_consent", "severity": "review", "message": "..." } ],
  "missingData": ["Mess- und Zählerkonzept"],
  "estimatedEffort": "mittel",
  "nextPaidStep": { "offerCode": "et_eligibility", "requiredData": [...] }
}`,
    refuses: [{ code: "400 validation_error", when: "Eingaben unvollständig oder außerhalb des Bereichs" }],
  },
  {
    method: "POST",
    path: `${API_PREFIX}/messkonzept`,
    summary: "Messkonzept, Zählerinventar und kritischer Pfad",
    purpose:
      "Leitet aus der Konstellation die Messvariante, das vollständige Zählerinventar mit Anzahl und Anforderung an Zählerstandsgangmessung, die Marktrollen und die geordnete Aufgabenliste ab.",
    parameters: [
      { name: "constellation.units", type: "integer", required: true, description: "Anzahl der Einheiten." },
      { name: "constellation.kwp", type: "number", required: true, description: "Anlagengröße." },
      { name: "constellation.gridConnection", type: "enum", required: false, description: "single_connection, per_unit_connection oder public_grid. Ohne diese Angabe lautet das Ergebnis not_determinable." },
      { name: "constellation.storage", type: "enum", required: false, description: "none, planned oder existing." },
    ],
    example: `curl -X POST -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"constellation":{"units":24,"kwp":60,"gridConnection":"single_connection"}}' \\
  ${API_BASE_URL_PLACEHOLDER}${API_PREFIX}/messkonzept`,
    responseExample: `{
  "ok": true,
  "variant": "summenzaehler",
  "meterCount": 26,
  "meters": [ { "code": "unterzaehler", "count": 24, "intervalMetering": false } ],
  "criticalPath": [ { "code": "messkonzept_submit", "owner": "Anlagenbetreiber" } ],
  "confidence": "medium",
  "disclaimer": "Vorschlag für die technische Ausgestaltung. ..."
}`,
    refuses: [{ code: "400 validation_error", when: "Unbekannter Wert für gridConnection oder storage" }],
  },
  {
    method: "POST",
    path: `${API_PREFIX}/allocation`,
    summary: "Aufteilungsschlüssel, viertelstundengenau",
    purpose:
      "Verteilt die Erzeugung über die übergebenen Intervalle nach einem oder allen drei Schlüsseln. Zuordnung plus Einspeisung ergibt konstruktionsbedingt exakt die Erzeugung, in jedem Intervall.",
    parameters: [
      { name: "generationKwh", type: "number[]", required: true, description: "Erzeugung je Intervall in kWh." },
      { name: "participants", type: "object[]", required: true, description: "Je Teilnehmer id, optional share, und consumptionKwh in derselben Länge wie generationKwh." },
      { name: "key", type: "enum", required: false, description: "static, dynamic oder cascading. Weggelassen werden alle drei gerechnet und verglichen." },
      { name: "includeSeries", type: "boolean", required: false, description: "Reihen je Intervall mitliefern." },
    ],
    example: `curl -X POST -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"generationKwh":[0,4,10,2],
       "participants":[{"id":"a","share":0.5,"consumptionKwh":[1,1,1,1]},
                       {"id":"b","share":0.5,"consumptionKwh":[1,5,5,1]}]}' \\
  ${API_BASE_URL_PLACEHOLDER}${API_PREFIX}/allocation`,
    responseExample: `{
  "ok": true,
  "runs": {
    "static":    { "totals": { "allocatedKwh": 11, "feedInKwh": 5, "selfConsumptionRate": 0.6875 } },
    "cascading": { "totals": { "allocatedKwh": 12, "feedInKwh": 4, "selfConsumptionRate": 0.75 } }
  },
  "recommendation": { "key": "dynamic", "additionalSelfConsumptionPoints": 6.25 }
}`,
    refuses: [
      { code: "400 unsupported_input", when: "Eine Verbrauchsreihe passt nicht zur Erzeugungsreihe" },
      { code: "400 unsupported_input", when: "Die Summe der Anteile überschreitet 100 %" },
    ],
  },
  {
    method: "POST",
    path: `${API_PREFIX}/billing`,
    summary: "Jahresabrechnung, in ganzen Cent",
    purpose:
      "Erzeugt je Teilnehmer eine Abrechnung aus gemessenen Mengen. Jede Summe ist die Summe der Positionen darüber, und die Antwort enthält eine unabhängige Rekonziliation, mit der ein Integrator das nachprüfen kann, ohne dem Erzeuger zu vertrauen.",
    parameters: [
      { name: "period", type: "object", required: true, description: "from und to als JJJJ-MM-TT, halboffen." },
      { name: "tariff", type: "object", required: true, description: "Arbeitspreise und Grundpreis. Optional der örtliche Grundversorgungstarif für den Vergleich." },
      { name: "participants", type: "object[]", required: true, description: "Je Teilnehmer allocatedKwh, gridDrawKwh, optional Abschläge und Zählernummer." },
    ],
    example: `curl -X POST -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"period":{"from":"2026-01-01","to":"2027-01-01"},
       "tariff":{"mieterstromCtPerKwh":28,"reststromCtPerKwh":34,"grundpreisEurPerYear":120},
       "participants":[{"id":"we-1","allocatedKwh":1200,"gridDrawKwh":1800}]}' \\
  ${API_BASE_URL_PLACEHOLDER}${API_PREFIX}/billing`,
    responseExample: `{
  "ok": true,
  "days": 365,
  "statements": [ { "id": "we-1", "netCents": 108216, "grossCents": 128777, "balanceCents": 128777 } ],
  "totals": { "grossCents": 128777 },
  "reconciliation": { "ok": true, "failures": [] },
  "conventions": ["Der Grundpreis wird taggenau anteilig berechnet (Tage im Zeitraum / 365)."]
}`,
    refuses: [
      { code: "400 unsupported_input", when: "Der Zeitraum ist umgekehrt oder leer" },
      { code: "400 unsupported_input", when: "Eine Teilnehmer-ID kommt mehrfach vor" },
    ],
  },
  {
    method: "GET",
    path: `${MAKO_PREFIX}/grid`,
    summary: "Das echte Viertelstundenraster eines Tages oder Zeitraums",
    purpose:
      "Liefert die tatsächliche Anzahl der Intervalle — 92, 96 oder 100 — abgeleitet aus dem Kalender, nicht angenommen. Der Endpunkt, mit dem sich eine bestehende Implementierung an den beiden Umstellungstagen prüfen lässt.",
    parameters: [
      { name: "date", type: "string", required: false, description: "Ein lokaler Tag als JJJJ-MM-TT." },
      { name: "from / to", type: "string", required: false, description: "Halboffener Zeitraum. Entweder date oder from und to." },
    ],
    example: `curl -H "Authorization: Bearer $KEY" \\
  "${API_BASE_URL_PLACEHOLDER}${MAKO_PREFIX}/grid?date=2026-10-25"`,
    responseExample: `{
  "ok": true,
  "timezone": "Europe/Berlin",
  "intervals": 100,
  "days": [ { "date": "2026-10-25", "intervals": 100, "kind": "dst_long" } ],
  "firstIntervalStart": "202610250000+02",
  "lastIntervalStart":  "202610252345+01"
}`,
    refuses: [{ code: "400 unsupported_input", when: "Kein gültiges Datum oder umgekehrter Zeitraum" }],
  },
  {
    method: "POST",
    path: `${MAKO_PREFIX}/identifiers`,
    summary: "Marktidentifikatoren prüfen, bevor etwas gesendet wird",
    purpose:
      "Prüft MaLo, MeLo, BDEW-Codenummern und EIC. Formatregeln werden zugesichert; Prüfziffernverfahren sind Veröffentlichungen Dritter und werden als algorithm_unverified gemeldet, solange die Umsetzung nicht gegen die Veröffentlichung geprüft ist.",
    parameters: [
      { name: "senderCode", type: "string", required: true, description: "BDEW-Codenummer des Absenders." },
      { name: "receiverCode", type: "string", required: true, description: "BDEW-Codenummer des Empfängers." },
      { name: "malo / melo / balancingAreaEic", type: "string", required: false, description: "Werden geprüft, wenn übergeben." },
    ],
    example: `curl -X POST -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"senderCode":"9999999999994","receiverCode":"8888888888888"}' \\
  ${API_BASE_URL_PLACEHOLDER}${MAKO_PREFIX}/identifiers`,
    responseExample: `{
  "ok": true,
  "valid": true,
  "results": { "senderCode": { "format": "ok", "checkDigit": "algorithm_unverified" } },
  "algorithms": [ { "id": "malo", "verified": false, "openQuestion": "..." } ]
}`,
    refuses: [{ code: "400 validation_error", when: "Pflichtfeld fehlt" }],
  },
  {
    method: "POST",
    path: `${MAKO_PREFIX}/mscons`,
    summary: "MSCONS-Nachricht aus Viertelstundenwerten",
    purpose:
      "Baut die vollständige Übertragungsdatei. Segmentzählung und Kontrollreferenz werden aus dem Inhalt berechnet und in der Antwort aus der erzeugten Nachricht heraus nachgeprüft. Eine Reihe, die nicht zum Raster des Zeitraums passt, wird abgelehnt statt aufgefüllt.",
    parameters: [
      { name: "period", type: "object", required: true, description: "date, oder from und to." },
      { name: "sender / receiver", type: "object", required: true, description: "Je BDEW-Codenummer." },
      { name: "locations", type: "object[]", required: true, description: "Je Messlokation melo, direction, valuesKwh und optional statuses." },
    ],
    example: `curl -X POST -H "Authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"period":{"date":"2026-10-25"},
       "sender":{"code":"9999999999994"},"receiver":{"code":"8888888888888"},
       "locations":[{"melo":"${MELO_EXAMPLE}",
                     "direction":"consumption","valuesKwh":[/* 100 Werte */]}]}' \\
  ${API_BASE_URL_PLACEHOLDER}${MAKO_PREFIX}/mscons`,
    responseExample: `{
  "ok": true,
  "message": "UNA:+.? 'UNB+UNOC:3+...'",
  "bytes": 10879,
  "grid": { "intervals": 100, "dstDays": [ { "date": "2026-10-25", "intervals": 100 } ] },
  "syntax": { "ok": true, "messageCount": 1, "findings": [] },
  "profile": { "messageType": "MSCONS", "verified": false }
}`,
    refuses: [
      { code: "400 unsupported_input", when: "96 Werte für einen Tag mit 100 Viertelstunden — der Grund wird benannt" },
      { code: "400 unsupported_input", when: "Eine Messlokation kommt für dieselbe Energierichtung mehrfach vor" },
      { code: "400 unsupported_input", when: "Ein Identifikator ist formal ungültig" },
    ],
  },
];

/** Every path the documentation claims. Used by the drift test. */
export function documentedPaths(): string[] {
  return API_ENDPOINTS.map((e) => e.path);
}
