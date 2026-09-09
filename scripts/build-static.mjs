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

// The manifest is TypeScript; read the fields we need without a compile step.
const routesSource = readFileSync(join(process.cwd(), "shared", "routes.ts"), "utf8");

const ORIGIN = (process.env.APP_URL || "https://energie-teilen-site.vercel.app").replace(/\/+$/, "");

/** Parse the ROUTES array out of the manifest. */
function parseRoutes() {
  const body = routesSource.slice(
    routesSource.indexOf("export const ROUTES: RouteDefinition[] = ["),
  );
  const routes = [];
  const blockRe = /\{\s*\n\s*path: "([^"]+)",([\s\S]*?)\n  \},/g;
  let m;
  while ((m = blockRe.exec(body)) !== null) {
    const [, path, rest] = m;
    const field = (name) => {
      const r = new RegExp(`${name}:\\s*(?:\\n\\s*)?"((?:[^"\\\\]|\\\\.)*)"`);
      const hit = r.exec(rest);
      return hit ? hit[1].replace(/\\"/g, '"') : null;
    };
    const bool = (name) => new RegExp(`${name}: (true|false)`).exec(rest)?.[1] === "true";
    routes.push({
      path,
      title: field("title"),
      description: field("description"),
      navLabel: field("navLabel"),
      answers: field("answers"),
      indexable: bool("indexable"),
      changefreq: field("changefreq") ?? "monthly",
      priority: Number(/priority: ([\d.]+)/.exec(rest)?.[1] ?? "0.5"),
      kind: field("kind") ?? "tool",
    });
    if (routes.length > 40) break;
  }
  return routes;
}

const routes = parseRoutes();
if (routes.length < 5) {
  console.error(`Only parsed ${routes.length} routes from shared/routes.ts — refusing to continue.`);
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
  return (
    `\n    <noscript>\n` +
    `      <h1>${escapeAttr(route.navLabel)}</h1>\n` +
    `      <p>${escapeAttr(route.description)}</p>\n` +
    `      <p>${escapeAttr(route.answers)}</p>\n` +
    `    </noscript>\n`
  );
}

let written = 0;
for (const route of routes) {
  const url = `${ORIGIN}${route.path}`;
  let html = shell;

  html = replaceTitle(html, route.title);
  html = replaceMultilineMeta(html, "name", "description", route.description);
  html = replaceMultilineMeta(html, "property", "og:title", route.title);
  html = replaceMultilineMeta(html, "property", "og:description", route.description);
  html = replaceMultilineMeta(html, "property", "og:url", url);
  html = replaceMultilineMeta(html, "name", "twitter:title", route.title);
  html = replaceMultilineMeta(html, "name", "twitter:description", route.description);
  html = setCanonical(html, url);

  html = html.replace(
    "</head>",
    `    <script type="application/ld+json">\n${JSON.stringify(structuredDataFor(route), null, 2)}\n    </script>\n  </head>`,
  );

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
    .filter((r) => r.indexable)
    .map(
      (r) =>
        `  <url>\n    <loc>${ORIGIN}${r.path}</loc>\n    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join("\n") +
  `\n</urlset>\n`;

writeFileSync(join(DIST, "sitemap.xml"), sitemap);
writeFileSync(
  join(DIST, "robots.txt"),
  ["User-agent: *", "Allow: /", "", `Sitemap: ${ORIGIN}/sitemap.xml`, ""].join("\n"),
);

const indexable = routes.filter((r) => r.indexable).length;
console.log(
  `static: ${written} documents, ${indexable} in the sitemap` +
    ` (was 1 document and 4 sitemap entries, three of them legal pages)`,
);
