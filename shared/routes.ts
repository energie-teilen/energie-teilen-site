/**
 * shared/routes.ts
 *
 * The route manifest — one source of truth for every page this site serves.
 *
 * Everything that has to agree about routes reads from here: the router, the
 * per-route document head, the sitemap, the internal link graph and the tests
 * that check they have not drifted apart. Adding a page in one place and
 * forgetting the other three is how a site ends up with pages Google cannot
 * find and a sitemap listing pages that no longer exist.
 *
 * Each tool has its own route on purpose. A section inside a long page cannot
 * be indexed, cannot be linked to from an answer, and cannot rank for the
 * question it answers. The engines were already built; what they lacked was a
 * door.
 */

export type RouteKind = "landing" | "tool" | "reference" | "legal" | "system";

export type StructuredData = Record<string, unknown>;

export type RouteDefinition = {
  path: string;
  kind: RouteKind;
  /** Document title. Kept under ~60 characters so it is not truncated. */
  title: string;
  /** Meta description. 120–160 characters. */
  description: string;
  /** Short label for navigation and breadcrumbs. */
  navLabel: string;
  /**
   * The question this page exists to answer, in the words someone would use.
   * Written down because a page without one is a page with no reason to rank.
   */
  answers: string;
  /** Included in the sitemap. */
  indexable: boolean;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
  /** Routes a reader of this page most plausibly needs next. */
  relatedPaths: string[];
  /** JSON-LD emitted into this page's head, beyond the site-wide graph. */
  structuredData?: StructuredData;
  /**
   * This path serves another page's content under a second URL.
   *
   * The alias keeps working — links to it exist and should not break — but it
   * points its canonical at the page it duplicates and stays out of the
   * sitemap. Two URLs serving the same document under two canonicals split
   * whatever ranking either would have earned and read, correctly, as a site
   * that does not know what its own pages are.
   */
  aliasOf?: string;
};

/**
 * The one address this site calls itself by.
 *
 * Everything that has to agree — canonical links, hreflang, OpenGraph, the
 * structured data, the sitemap, robots.txt, the discovery files, the links in
 * the PDF report and the analytics domain — reads it from here. A second
 * literal somewhere else is how a site ends up telling Google one address and
 * a link preview another; origin.test.ts fails if one appears.
 *
 * Two sources, in this order:
 *
 *   1. APP_URL at BUILD time, injected into the browser bundle as
 *      __APP_ORIGIN__ by vite.config.ts. The client has no process.env, so
 *      without this the running application would fall back while the
 *      generated documents used the real address.
 *   2. APP_URL in the environment, for the server, the build scripts and the
 *      tests.
 *
 * The fallback below is the deployment's own address, used only while APP_URL
 * is unset. It is a hosting URL, not an identity: setting APP_URL is what
 * makes the product's address its own.
 */
export const ORIGIN_FALLBACK = "https://energie-teilen-site.vercel.app";

/** Injected by vite.config.ts at build time. Absent everywhere else. */
declare const __APP_ORIGIN__: string | undefined;

function normalise(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * The origin the operator configured, or null while APP_URL is unset.
 *
 * Callers that must distinguish "configured" from "defaulted" — the analytics
 * domain, the health scoreboard — ask for this rather than comparing strings.
 */
export function configuredOrigin(): string | null {
  const fromBuild = typeof __APP_ORIGIN__ === "string" ? __APP_ORIGIN__ : "";
  if (fromBuild.trim().length > 0) return normalise(fromBuild);

  const fromEnv = typeof process !== "undefined" ? process.env?.APP_URL : undefined;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return normalise(fromEnv);

  return null;
}

/** The public origin, without a trailing slash. */
export function siteOrigin(): string {
  return configuredOrigin() ?? ORIGIN_FALLBACK;
}

/** The host alone, for display and for the analytics domain. */
export function siteHost(): string {
  return siteOrigin().replace(/^https?:\/\//, "");
}

export function absoluteUrl(path: string): string {
  return `${siteOrigin()}${path === "/" ? "/" : path}`;
}

// ============================================================================
// ROUTES
// ============================================================================

export const ROUTES: RouteDefinition[] = [
  {
    path: "/",
    kind: "landing",
    title: "Energie Teilen — Mieterstrom rechnen, prüfen, umsetzen",
    description:
      "Wirtschaftlichkeit, Messkonzept, Aufteilungsschlüssel und Marktkommunikation für lokale Energieprojekte. Kostenlose Rechner, dokumentierte Annahmen, bezahlte Pilotaufnahme.",
    navLabel: "Start",
    answers: "Lohnt sich mein Mieterstromprojekt, und was ist der nächste Schritt?",
    indexable: true,
    changefreq: "weekly",
    priority: 1.0,
    relatedPaths: ["/rechner", "/messkonzept", "/aufteilungsschluessel"],
  },
  {
    path: "/rechner",
    kind: "tool",
    aliasOf: "/",
    title: "Mieterstrom-Rechner — Rendite, Amortisation, NPV",
    description:
      "Drei Szenarien mit dokumentierter Herkunft jeder Annahme: Amortisation, Kapitalwert, interner Zinsfuß und CO2. Kostenlos, ohne Anmeldung, Bericht als PDF.",
    navLabel: "Rechner",
    answers: "Rechnet sich eine PV-Anlage mit Mieterstrom in meinem Gebäude?",
    indexable: true,
    changefreq: "weekly",
    priority: 0.9,
    relatedPaths: ["/messkonzept", "/aufteilungsschluessel", "/"],
    structuredData: {
      "@type": "SoftwareApplication",
      name: "Mieterstrom-Rechner",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      featureList: [
        "Drei Szenarien parallel",
        "Kapitalwert, interner Zinsfuß, Amortisation",
        "Herkunft jeder Annahme ausgewiesen",
        "Bericht als PDF",
      ],
    },
  },
  {
    path: "/messkonzept",
    kind: "tool",
    title: "Messkonzept-Generator für Mieterstrom und Gebäudeversorgung",
    description:
      "Welches Messkonzept passt zu Ihrer Konstellation? Summenzähler, Einzelzähler oder Viertelstundenbilanzierung — mit Zählerinventar, Marktrollen und kritischem Pfad.",
    navLabel: "Messkonzept",
    answers: "Welches Messkonzept braucht mein Projekt und wie viele Zähler sind das?",
    indexable: true,
    changefreq: "monthly",
    priority: 0.9,
    relatedPaths: ["/aufteilungsschluessel", "/marktkommunikation", "/rechner"],
    structuredData: {
      "@type": "HowTo",
      name: "Messkonzept für ein Mieterstromprojekt bestimmen",
      step: [
        { "@type": "HowToStep", name: "Netzanschlusssituation klären" },
        { "@type": "HowToStep", name: "Zählerinventar ableiten" },
        { "@type": "HowToStep", name: "Marktrollen besetzen" },
        { "@type": "HowToStep", name: "Messkonzept beim Netzbetreiber einreichen" },
      ],
    },
  },
  {
    path: "/aufteilungsschluessel",
    kind: "tool",
    title: "Aufteilungsschlüssel berechnen und vergleichen",
    description:
      "Statisch, dynamisch oder mit Nachverteilung: welcher Schlüssel wie viel Strom bei den Teilnehmern lässt. Viertelstundengenau gerechnet, Energiebilanz exakt geschlossen.",
    navLabel: "Aufteilung",
    answers: "Welcher Aufteilungsschlüssel bringt den Teilnehmern am meisten?",
    indexable: true,
    changefreq: "monthly",
    priority: 0.9,
    relatedPaths: ["/messkonzept", "/marktkommunikation", "/rechner"],
    structuredData: {
      "@type": "SoftwareApplication",
      name: "Aufteilungsschlüssel-Vergleich",
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    },
  },
  {
    path: "/marktkommunikation",
    kind: "tool",
    title: "MSCONS und das Viertelstundenraster — 92, 96 oder 100",
    description:
      "Zweimal im Jahr hat ein Tag nicht 96 Viertelstunden. Erzeugte MSCONS-Nachricht mit geprüfter Syntax, korrektem Zeitraster und maskierten OBIS-Kennzahlen.",
    navLabel: "Marktkommunikation",
    answers: "Wie viele Viertelstunden hat der Tag der Zeitumstellung, und wie sieht die Nachricht aus?",
    indexable: true,
    changefreq: "monthly",
    priority: 0.85,
    relatedPaths: ["/api", "/messkonzept", "/aufteilungsschluessel"],
    structuredData: {
      "@type": "TechArticle",
      headline: "Das Viertelstundenraster der Zeitumstellung in der Marktkommunikation",
      about: ["MSCONS", "EDIFACT", "Zeitumstellung", "Marktkommunikation"],
    },
  },
  {
    path: "/api",
    kind: "reference",
    title: "API — dieselbe Engine hinter einem Schlüssel",
    description:
      "Neun Endpunkte für Wirtschaftlichkeit, Qualifizierung, Messkonzept, Aufteilung, Abrechnung und Marktkommunikation. Jede Antwort mit Modellstempel und Herkunft.",
    navLabel: "API",
    answers: "Kann ich diese Berechnungen in mein eigenes System einbauen?",
    indexable: true,
    changefreq: "monthly",
    priority: 0.8,
    relatedPaths: ["/marktkommunikation", "/messkonzept", "/"],
    structuredData: {
      "@type": "TechArticle",
      headline: "Energie Teilen API v1",
      about: ["API", "Mieterstrom", "Marktkommunikation", "MSCONS"],
    },
  },
  {
    path: "/impressum",
    kind: "legal",
    title: "Impressum",
    description:
      "Anbieterkennzeichnung, Kontaktangaben, Registereintrag und Umsatzsteuer-Identifikationsnummer des Betreibers dieser Website.",
    navLabel: "Impressum",
    answers: "Wer betreibt diese Seite?",
    indexable: true,
    changefreq: "yearly",
    priority: 0.3,
    relatedPaths: ["/datenschutz", "/agb"],
  },
  {
    path: "/datenschutz",
    kind: "legal",
    title: "Datenschutzerklärung",
    description:
      "Welche Daten diese Website verarbeitet, wozu, auf welcher Rechtsgrundlage und wie lange.",
    navLabel: "Datenschutz",
    answers: "Was passiert mit meinen Daten?",
    indexable: true,
    changefreq: "yearly",
    priority: 0.3,
    relatedPaths: ["/impressum", "/agb"],
  },
  {
    path: "/agb",
    kind: "legal",
    title: "Allgemeine Geschäftsbedingungen",
    description:
      "Bedingungen für die kostenpflichtige Pilotaufnahme: Leistungsgegenstand je Stufe, Vertragsschluss, Vergütung, Mitwirkung und Nutzungsrechte.",
    navLabel: "AGB",
    answers: "Zu welchen Bedingungen wird die Pilotaufnahme erbracht?",
    indexable: true,
    changefreq: "yearly",
    priority: 0.3,
    relatedPaths: ["/impressum", "/datenschutz"],
  },
  {
    path: "/404",
    kind: "system",
    title: "Seite nicht gefunden",
    description:
      "Die aufgerufene Adresse führt ins Leere. Von hier aus geht es direkt zu den Rechnern und zur Pilotaufnahme.",
    navLabel: "404",
    answers: "—",
    indexable: false,
    changefreq: "yearly",
    priority: 0.0,
    relatedPaths: ["/"],
  },
];

export const ROUTE_BY_PATH: Record<string, RouteDefinition> = Object.fromEntries(
  ROUTES.map((r) => [r.path, r]),
);

export function routeFor(path: string): RouteDefinition | null {
  const normalised = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return ROUTE_BY_PATH[normalised] ?? null;
}

/** Routes that belong in the sitemap. */
export function indexableRoutes(): RouteDefinition[] {
  // An alias is a second URL for a page already listed. Listing it too asks a
  // crawler to choose between two identical documents.
  return ROUTES.filter((r) => r.indexable && !r.aliasOf);
}

/** The URL a page should declare as its own, following any alias. */
export function canonicalPathFor(path: string): string {
  return routeFor(path)?.aliasOf ?? path;
}

/** The tools, in the order they appear in navigation. */
export function toolRoutes(): RouteDefinition[] {
  return ROUTES.filter((r) => r.kind === "tool");
}

/**
 * Everything the primary navigation offers: the tools plus the reference.
 *
 * Separate from toolRoutes() because the API reference is not a tool but is
 * exactly what a technical evaluator is looking for, and leaving it out of the
 * navigation made it unreachable except by typing the URL.
 */
export function navRoutes(): RouteDefinition[] {
  return ROUTES.filter((r) => r.kind === "tool" || r.kind === "reference");
}

// ============================================================================
// SITEMAP
// ============================================================================

/**
 * Generated from the manifest rather than maintained by hand, so it cannot
 * list a page that does not exist or omit one that does.
 */
export function buildSitemap(lastModified: string): string {
  const urls = indexableRoutes()
    .map(
      (r) =>
        `  <url>\n` +
        `    <loc>${absoluteUrl(r.path)}</loc>\n` +
        `    <lastmod>${lastModified}</lastmod>\n` +
        `    <changefreq>${r.changefreq}</changefreq>\n` +
        `    <priority>${r.priority.toFixed(1)}</priority>\n` +
        `  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function buildRobots(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    "# Nothing here is behind a login, and the calculators are the point.",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
}
