import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ROUTES,
  ROUTE_BY_PATH,
  absoluteUrl,
  buildRobots,
  buildSitemap,
  indexableRoutes,
  routeFor,
  navRoutes,
  toolRoutes,
} from "../../../shared/routes";
import { API_ENDPOINTS, documentedPaths } from "../../../shared/api-reference";

const ROOT = join(__dirname, "..", "..", "..");

describe("the route manifest", () => {
  it("has a unique path per route", () => {
    const paths = ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("gives every route a title that will not be truncated in a result", () => {
    for (const r of ROUTES) {
      expect(r.title.length, `${r.path} title length`).toBeGreaterThan(8);
      expect(r.title.length, `${r.path} title: "${r.title}"`).toBeLessThanOrEqual(70);
    }
  });

  it("gives every route a description of usable length", () => {
    for (const r of ROUTES) {
      expect(r.description.length, `${r.path} description`).toBeGreaterThanOrEqual(50);
      expect(r.description.length, `${r.path} description`).toBeLessThanOrEqual(230);
    }
  });

  /*
   * A page without a question it answers is a page with no reason to rank and
   * no reason to exist. Writing it down is what stops one being added anyway.
   */
  it("makes every route state the question it answers", () => {
    for (const r of ROUTES) {
      if (r.kind === "system") continue;
      expect(r.answers.length, `${r.path} answers`).toBeGreaterThan(12);
    }
  });

  it("only links to routes that exist", () => {
    for (const r of ROUTES) {
      for (const related of r.relatedPaths) {
        expect(ROUTE_BY_PATH[related], `${r.path} links to ${related}`).toBeDefined();
      }
    }
  });

  it("never links a route to itself", () => {
    for (const r of ROUTES) expect(r.relatedPaths).not.toContain(r.path);
  });

  it("keeps the 404 route out of the index", () => {
    expect(routeFor("/404")?.indexable).toBe(false);
    expect(indexableRoutes().map((r) => r.path)).not.toContain("/404");
  });

  it("resolves a trailing slash to the same route", () => {
    expect(routeFor("/messkonzept/")?.path).toBe("/messkonzept");
    expect(routeFor("/")?.path).toBe("/");
  });

  it("returns null for an unknown path rather than guessing", () => {
    expect(routeFor("/gibt-es-nicht")).toBeNull();
  });
});

describe("the tools are reachable", () => {
  it("exposes every tool as its own route", () => {
    const paths = toolRoutes().map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining(["/rechner", "/messkonzept", "/aufteilungsschluessel", "/marktkommunikation"]),
    );
  });

  /*
   * Each tool exists as a route so it can be indexed and linked to. That only
   * holds if the router actually mounts it.
   */
  it("mounts every manifest route in the router", () => {
    const app = readFileSync(join(ROOT, "client", "src", "App.tsx"), "utf8");
    for (const r of ROUTES) {
      if (r.path === "/404") continue;
      expect(app, `App.tsx mounts ${r.path}`).toContain(`path={"${r.path}"}`);
    }
  });

  it("links every tool from the footer via the manifest", () => {
    const footer = readFileSync(join(ROOT, "client", "src", "components", "Footer.tsx"), "utf8");
    expect(footer, "footer reads the manifest rather than a hand-kept list").toContain("navRoutes()");
    expect(footer).not.toContain("in Vorbereitung");
  });

  it("offers the reference in navigation, not only the tools", () => {
    // The API reference is not a tool but is exactly what a technical
    // evaluator looks for; leaving it out made it reachable only by URL.
    expect(navRoutes().map((r) => r.path)).toContain("/api");
  });

  it("uses each navigation label exactly once", () => {
    const labels = navRoutes().map((r) => r.navLabel);
    expect(new Set(labels).size, `duplicate label in ${labels.join(", ")}`).toBe(labels.length);
  });

  it("links the tools from the header", () => {
    const header = readFileSync(join(ROOT, "client", "src", "components", "Header.tsx"), "utf8");
    expect(header).toContain("navRoutes()");
  });
});

describe("sitemap and robots", () => {
  it("lists every indexable route and nothing else", () => {
    const xml = buildSitemap("2026-09-09");
    for (const r of ROUTES) {
      const url = absoluteUrl(r.path);
      if (r.indexable) expect(xml, `${r.path} in sitemap`).toContain(`<loc>${url}</loc>`);
      else expect(xml, `${r.path} not in sitemap`).not.toContain(`<loc>${url}</loc>`);
    }
  });

  it("covers more than the legal pages", () => {
    const nonLegal = indexableRoutes().filter((r) => r.kind !== "legal");
    expect(nonLegal.length, "indexable pages that are not legal boilerplate").toBeGreaterThanOrEqual(6);
  });

  it("is well-formed and carries a lastmod on every entry", () => {
    const xml = buildSitemap("2026-09-09");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((xml.match(/<url>/g) ?? []).length).toBe(indexableRoutes().length);
    expect((xml.match(/<lastmod>/g) ?? []).length).toBe(indexableRoutes().length);
  });

  it("points robots.txt at the sitemap", () => {
    expect(buildRobots()).toContain(absoluteUrl("/sitemap.xml"));
  });
});

describe("the API reference matches the API", () => {
  /*
   * Nine endpoints existed with no documentation, so nobody outside this
   * repository could evaluate them. These two tests keep the reference and the
   * server from drifting apart in either direction.
   */
  const server = readFileSync(join(ROOT, "server", "api-v1.ts"), "utf8");

  it("documents every endpoint the server mounts", () => {
    const mounted = [...server.matchAll(/app\.(get|post)\(\s*`\$\{(API_PREFIX|MAKO_PREFIX)\}([^`]+)`/g)].map(
      (m) => (m[2] === "API_PREFIX" ? "/api/v1" : "/api/v1/mako") + m[3],
    );
    expect(mounted.length).toBeGreaterThanOrEqual(9);
    for (const path of mounted) {
      expect(documentedPaths(), `${path} is documented`).toContain(path);
    }
  });

  it("documents no endpoint the server does not mount", () => {
    for (const doc of API_ENDPOINTS) {
      // Mounted as `${API_PREFIX}/x` or `${MAKO_PREFIX}/x`; either way the
      // literal after the interpolation is what appears in the source.
      const suffix = doc.path.startsWith("/api/v1/mako")
        ? doc.path.replace("/api/v1/mako", "")
        : doc.path.replace("/api/v1", "");
      expect(server, `${doc.path} is mounted`).toContain(`}${suffix}\``);
    }
  });

  it("gives every endpoint a runnable example and a stated refusal", () => {
    for (const doc of API_ENDPOINTS) {
      expect(doc.example, `${doc.path} example`).toContain("curl");
      expect(doc.responseExample.length, `${doc.path} response`).toBeGreaterThan(40);
      expect(doc.refuses.length, `${doc.path} states what it refuses`).toBeGreaterThan(0);
    }
  });

  it("marks required parameters as required", () => {
    const calculate = API_ENDPOINTS.find((e) => e.path.endsWith("/calculate"))!;
    expect(calculate.parameters.find((p) => p.name === "inputs.kwp")?.required).toBe(true);
  });
});
