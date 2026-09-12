/**
 * scripts/build-static.mjs
 *
 * Emits one real HTML document per route, plus the sitemap and robots.txt.
 *
 * Why this exists: the application is a single-page app, so every route was
 * served the same index.html — the same <title>, the same description, the same
 * canonical URL. A crawler, a link preview and a chat unfurl all read the
 * served document, and all of them therefore saw the landing page's metadata
 * for every page on the site. Client-side title updates arrive too late for
 * most of them and not at all for some.
 *
 * Each generated file is the built shell with that route's head substituted and
 * its own JSON-LD appended. React still hydrates and takes over exactly as
 * before; nothing about the runtime changes.
 *
 * The sitemap is generated from the same manifest as the router, so the two
 * cannot disagree about which pages exist.
 *
 * Run after `vite build`:  node scripts/build-static.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

const DIST = join(process.cwd(), "dist", "public");
const SHELL = join(DIST, "index.html");

if (!existsSync(SHELL)) {
  console.error("dist/public/index.html not found — run `vite build` first.");
  process.exit(1);
}

import { loadManifests } from "./load-manifests.mjs";

// The manifests are executed rather than parsed, so a reformat of the source
// can never change what gets published. See scripts/load-manifests.mjs.
const manifests = await loadManifests();

// One origin for the whole product: shared/routes.ts, reading APP_URL.
const ORIGIN = manifests.siteOrigin();
const routes = manifests.ROUTES;
const faqFor = manifests.faqFor;
const canonicalPathFor = manifests.canonicalPathFor;

if (routes.length < 5) {
  console.error(`Only ${routes.length} routes in the manifest — refusing to continue.`);
  process.exit(1);
}

const shell = readFileSync(SHELL, "utf8");

const escapeAttr = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function replaceTitle(html, title) {
  return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(title)}</title>`);
}

function replaceMeta(html, matcher, attr, key, content) {
  const re = new RegExp(`<meta\\s+${attr}="${key}"[^>]*>`, "i");
  const tag = `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`;
  if (re.test(html)) return html.replace(re, tag);
  // Some tags are written across several lines; fall back to a targeted insert.
  return html.replace("</head>", `    ${tag}\n  </head>`);
}

function replaceMultilineMeta(html, attr, key, content) {
  const re = new RegExp(`<meta\\s+${attr}="${key}"\\s*\\n?\\s*content="[^"]*"\\s*/?>`, "i");
  const tag = `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`;
  if (re.test(html)) return html.replace(re, tag);
  return replaceMeta(html, null, attr, key, content);
}

function setCanonical(html, url) {
  const tag = `<link rel="canonical" href="${escapeAttr(url)}" />`;
  if (/<link rel="canonical"[^>]*>/i.test(html)) {
    return html.replace(/<link rel="canonical"[^>]*>/i, tag);
  }
  return html.replace("</head>", `    ${tag}\n  </head>`);
}

/** Page-level JSON-LD: breadcrumb plus whatever the route declares. */
function structuredDataFor(route) {
  const graph = [
    {
      "@type": "WebPage",
      "@id": `${ORIGIN}${route.path}#webpage`,
      url: `${ORIGIN}${route.path}`,
      name: route.title,
      description: route.description,
      inLanguage: "de-DE",
      isPartOf: { "@id": `${ORIGIN}/#website` },
    },
  ];

  const faq = faqFor(route.path);
  if (faq.length > 0) {
    // The answers are on the page in full. This block is the same text in the
    // form a crawler can extract without parsing the layout — which is how a
    // question gets answered with this page rather than about it.
    graph.push({
      "@type": "FAQPage",
      "@id": `${ORIGIN}${route.path}#faq`,
      mainEntity: faq.map((entry) => ({
        "@type": "Question",
        name: entry.question,
        acceptedAnswer: { "@type": "Answer", text: entry.answer },
      })),
    });
  }

  if (route.path !== "/") {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Startseite", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: route.navLabel, item: `${ORIGIN}${route.path}` },
      ],
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * Content a crawler sees without executing anything.
 *
 * Not a rendering of the application — a short, accurate summary of what the
 * page is, replaced the moment React hydrates. Empty for the landing page,
 * which already ships its content.
 */
function noscriptSummary(route) {
  if (route.path === "/") return "";
  const faq = faqFor(route.path)
    .map(
      (entry) =>
        `        <dt>${escapeAttr(entry.question)}</dt>\n` +
        `        <dd>${escapeAttr(entry.answer)}</dd>\n`,
    )
    .join("");

  return (
    `\n    <noscript>\n` +
    `      <h1>${escapeAttr(route.navLabel)}</h1>\n` +
    `      <p>${escapeAttr(route.description)}</p>\n` +
    `      <p>${escapeAttr(route.answers)}</p>\n` +
    (faq ? `      <dl>\n${faq}      </dl>\n` : "") +
    `    </noscript>\n`
  );
}

/**
 * The shell's own JSON-LD describes the LANDING page as well as the site.
 *
 * Copied unchanged into every document, it asserts the landing page's
 * questions and its @id on /messkonzept — the same identifier claimed at two
 * URLs, which invalidates both. The site-level entities are true everywhere and
 * stay; the page-level ones belong only to the page they describe.
 */
const PAGE_SPECIFIC_TYPES = new Set(["FAQPage", "HowTo", "WebPage", "BreadcrumbList"]);

function stripLandingPageEntities(html, route) {
  if (route.path === "/") return html;
  return html.replace(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    (whole, body) => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return whole; // Leave anything unparseable alone rather than corrupt it.
      }
      if (!Array.isArray(parsed["@graph"])) return whole;
      parsed["@graph"] = parsed["@graph"].filter((n) => !PAGE_SPECIFIC_TYPES.has(n["@type"]));
      return `<script type="application/ld+json">${JSON.stringify(parsed)}</script>`;
    },
  );
}

let written = 0;
for (const route of routes) {
  const url = `${ORIGIN}${route.path}`;
  // An alias points at the page it duplicates, not at itself.
  const canonicalUrl = `${ORIGIN}${canonicalPathFor(route.path)}`;
  let html = shell;

  html = replaceTitle(html, route.title);
  html = replaceMultilineMeta(html, "name", "description", route.description);
  html = replaceMultilineMeta(html, "property", "og:title", route.title);
  html = replaceMultilineMeta(html, "property", "og:description", route.description);
  html = replaceMultilineMeta(html, "property", "og:url", canonicalUrl);
  html = replaceMultilineMeta(html, "name", "twitter:title", route.title);
  html = replaceMultilineMeta(html, "name", "twitter:description", route.description);
  html = setCanonical(html, canonicalUrl);
  html = stripLandingPageEntities(html, route);

  // Marked, and any earlier copy removed first: running this script twice over
  // the same output must produce the same document, not two of everything.
  html = html.replace(
    /\n\s*<script type="application\/ld\+json" data-route-graph>[\s\S]*?<\/script>/g,
    "",
  );
  html = html.replace(
    "</head>",
    `    <script type="application/ld+json" data-route-graph>\n${JSON.stringify(structuredDataFor(route), null, 2)}\n    </script>\n  </head>`,
  );

  html = html.replace(/<body>\s*<noscript>[\s\S]*?<\/noscript>\n/, "<body>");
  html = html.replace("<body>", `<body>${noscriptSummary(route)}`);

  // "/" is the shell itself; everything else becomes <path>/index.html so a
  // static host serves it for that URL without a rewrite rule.
  const target = route.path === "/" ? SHELL : join(DIST, route.path.slice(1), "index.html");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
  written++;
}

const today = new Date().toISOString().slice(0, 10);
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  routes
    .filter((r) => r.indexable && !r.aliasOf)
    .map(
      (r) =>
        `  <url>\n    <loc>${ORIGIN}${r.path}</loc>\n    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join("\n") +
  `\n</urlset>\n`;

writeFileSync(join(DIST, "sitemap.xml"), sitemap);

// robots.txt is written by scripts/build-discovery.mjs, which names the AI
// crawlers individually. One file, one owner: two scripts writing it meant the
// richer version survived only because of the order they happened to run in.

const indexable = routes.filter((r) => r.indexable && !r.aliasOf).length;
console.log(
  `static: ${written} documents, ${indexable} in the sitemap` +
    ` (was 1 document and 4 sitemap entries, three of them legal pages)`,
);
