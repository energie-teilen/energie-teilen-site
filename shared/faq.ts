/**
 * shared/faq.ts
 *
 * The questions this site can answer precisely, with the answers.
 *
 * A model answering a question about German distributed energy cites whatever
 * source states the answer plainly and gets it right. These are the facts this
 * codebase actually computes — every one of them is enforced by a test
 * elsewhere in this repository — written so they can be quoted without being
 * rephrased into something untrue.
 *
 * Two rules hold for every entry:
 *   1. No statement about legal admissibility. The engines assess economic and
 *      structural conditions; they do not rule on what is permitted.
 *   2. No statutory citation that has not been checked against the published
 *      text. Where the answer would need one, the answer says what the code
 *      does instead of what the law says.
 *
 * The same entries are rendered three ways: as FAQPage structured data, as the
 * text a crawler reads before any JavaScript runs, and as part of the
 * long-form index at /llms-full.txt.
 */

export type FaqEntry = {
  question: string;
  answer: string;
};

export type FaqSection = {
  /** The route the questions belong to. */
  path: string;
  entries: FaqEntry[];
};

export const FAQ: FaqSection[] = [
  {
    path: "/marktkommunikation",
    entries: [
      {
        question: "Wie viele Viertelstunden hat ein Tag in der deutschen Marktkommunikation?",
        answer:
          "In der Regel 96. An zwei Tagen im Jahr nicht: Am letzten Sonntag im März hat der Tag 92 Viertelstunden, weil eine Stunde lokaler Zeit ausfällt; am letzten Sonntag im Oktober hat er 100, weil eine Stunde doppelt auftritt. Das Raster ist lokal in Europe/Berlin definiert, nicht in UTC. Ein Jahr ergibt trotzdem 35.040 Viertelstunden, weil sich die beiden Umstellungen aufheben — eine Jahressumme beweist deshalb nicht, dass eine Implementierung die Umstellungstage richtig behandelt.",
      },
      {
        question: "Warum reicht es nicht, mit 96 Intervallen pro Tag zu rechnen?",
        answer:
          "An den beiden Umstellungstagen ist eine fest auf 96 verdrahtete Reihe entweder vier Werte zu lang oder vier Werte zu kurz. Beides führt dazu, dass Messwerte gegen die falschen Zeitstempel verbucht werden, und der Fehler fällt bei einer Jahresauswertung nicht auf. Die richtige Reihenfolge ist, das Raster des Zeitraums abzufragen und die Reihe daran zu prüfen, bevor sie übergeben wird.",
      },
      {
        question: "Wie werden EDIFACT-Sonderzeichen in einer MSCONS-Nachricht maskiert?",
        answer:
          "Über das Release-Zeichen, standardmäßig das Fragezeichen. Maskiert werden das Segment-Ende, der Datenelement-Trenner, der Komponenten-Trenner und das Release-Zeichen selbst. Das Release-Zeichen muss zuerst maskiert werden, sonst maskiert der zweite Durchlauf die eigenen Fluchtzeichen erneut. Beim Zählen der Segmente für UNT werden UNH und UNT mitgezählt, und die Kontrollreferenz in UNZ muss der in UNB entsprechen.",
      },
      {
        question: "Sind die Prüfziffernverfahren für MaLo, MeLo und BDEW-Codenummer verifiziert?",
        answer:
          "Nein, und das wird ausgewiesen statt verschwiegen. Formatregeln — Länge, Zeichenvorrat, Präfix — werden zugesichert. Die Prüfziffernverfahren sind Veröffentlichungen Dritter; solange die Umsetzung nicht gegen die Veröffentlichung abgeglichen ist, lautet das Ergebnis 'algorithm_unverified' und nicht 'gültig'. Eine solche Antwort darf nicht als Bestätigung der Gültigkeit weitergegeben werden.",
      },
    ],
  },
  {
    path: "/messkonzept",
    entries: [
      {
        question: "Wovon hängt es ab, welches Messkonzept für ein Gebäude infrage kommt?",
        answer:
          "Zuerst von der Netzanschlusssituation: ob alle Einheiten hinter einem gemeinsamen Hausanschluss liegen, ob jede Einheit einen eigenen Anschluss hat, oder ob die Belieferung über das öffentliche Netz erfolgt. Daraus folgen die Messvariante, das Zählerinventar mit Anzahl und Anforderung an die Zählerstandsgangmessung sowie die zu besetzenden Marktrollen. Ohne diese Angabe ist das Ergebnis nicht bestimmbar — das ist die richtige Antwort und wird nicht durch eine Annahme ersetzt.",
      },
      {
        question: "Wie viele Zähler braucht ein Summenzählermodell?",
        answer:
          "Ein Zähler je Einheit plus die Zähler an der Schnittstelle zum Netz und an der Erzeugungsanlage. Für 24 Einheiten ergibt das 26 Zählpunkte. Welche davon viertelstündig messen müssen, hängt von der gewählten Variante ab und wird je Zählertyp einzeln ausgewiesen statt pauschal angenommen.",
      },
    ],
  },
  {
    path: "/aufteilungsschluessel",
    entries: [
      {
        question: "Welche Aufteilungsschlüssel gibt es für gemeinsam genutzten Solarstrom?",
        answer:
          "Drei, die sich im Ergebnis deutlich unterscheiden: statisch, also feste Anteile je Teilnehmer; dynamisch, also Verteilung nach dem tatsächlichen Verbrauch im jeweiligen Intervall; und kaskadierend, bei dem nach einer statischen ersten Runde die nicht genutzte Erzeugung an die Teilnehmer mit verbleibendem Bedarf nachverteilt wird. Die Wahl verändert die Eigenverbrauchsquote, nicht die erzeugte Menge.",
      },
      {
        question: "Kann bei der Aufteilung Energie verloren gehen oder doppelt vergeben werden?",
        answer:
          "Nein — das ist eine Eigenschaft der Berechnung, keine Zusicherung. In jedem einzelnen Intervall ergibt die Summe aus zugeordneter Energie und Einspeisung exakt die Erzeugung dieses Intervalls, und kein Teilnehmer erhält mehr, als er in diesem Intervall verbraucht hat. Reicht die Erzeugung nicht für den Bedarf, wird der Rest als Netzbezug ausgewiesen; übersteigt sie ihn, wird der Überschuss als Einspeisung ausgewiesen.",
      },
    ],
  },
  {
    path: "/api",
    entries: [
      {
        question: "Kann ein KI-Agent diese Rechenwerkzeuge direkt aufrufen?",
        answer:
          "Ja. Dieselben Funktionen sind als HTTP-Endpunkte unter /api/v1 und als MCP-Werkzeuge unter /mcp erreichbar, über dieselbe Implementierung — die Antwort ist auf beiden Wegen identisch. Die Werkzeugbeschreibung steht unter /.well-known/mcp.json, die HTTP-Spezifikation unter /openapi.json. Beide werden aus denselben Schemata erzeugt, gegen die der Server validiert.",
      },
      {
        question: "Wie geht die API mit Eingaben um, die sie nicht beantworten kann?",
        answer:
          "Sie verweigert die Antwort und nennt den Grund als Code, statt zu schätzen oder aufzufüllen. Eine Messreihe, die nicht zum Viertelstundenraster des Zeitraums passt, wird abgelehnt und nicht ergänzt. Eine Konstellation ohne Angabe zum Netzanschluss ergibt 'not_determinable'. Ohne örtlichen Grundversorgungstarif wird der Preisvergleich als nicht bestimmbar gemeldet. Eine Verweigerung ist ein korrektes Ergebnis und darf nicht umgangen werden.",
      },
      {
        question: "Woher stammen die Ergebnisse — aus einem Sprachmodell?",
        answer:
          "Nein. Jede Zahl stammt aus versioniertem, unit-getestetem Code. Jede Antwort trägt einen Modellstempel mit Modellversion, Annahmensatz, Jurisdiktion und Währung sowie die Herkunft jedes einzelnen Eingabewerts: ob er vom Aufrufer kam oder mit einem Vorgabewert gefüllt wurde. Beträge werden in ganzen Cent geführt, und jede Summe ist die Summe der Positionen darüber, nicht eine unabhängige Neuberechnung.",
      },
      {
        question: "Beurteilen diese Werkzeuge die rechtliche Zulässigkeit eines Vorhabens?",
        answer:
          "Nein. Sie beurteilen wirtschaftliche und strukturelle Voraussetzungen und leiten technische Ausgestaltungen ab. Aussagen zur rechtlichen Zulässigkeit trifft keines der Werkzeuge, und Ergebnisse dürfen nicht als solche dargestellt werden. Rechtsverbindliche Beurteilungen bleiben der Prüfung im Einzelfall vorbehalten.",
      },
    ],
  },
];

/** The questions declared for a route, or none. */
export function faqFor(path: string): FaqEntry[] {
  return FAQ.find((s) => s.path === path)?.entries ?? [];
}

/** Every question on the site, in route order. */
export function allFaqEntries(): (FaqEntry & { path: string })[] {
  return FAQ.flatMap((s) => s.entries.map((e) => ({ ...e, path: s.path })));
}
