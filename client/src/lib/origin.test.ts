import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import {
  ORIGIN_FALLBACK,
  absoluteUrl,
  buildRobots,
  buildSitemap,
  configuredOrigin,
  siteHost,
  siteOrigin,
} from "../../../shared/routes";
import { analyticsDomain } from "./analytics";

/*
 * One public origin.
 *
 * The site told Google one address and a link preview another: the canonical
 * link, hreflang, OpenGraph, the structured data, the PDF's links and the
 * analytics domain each carried the hosting URL as a literal, while the
 * sitemap and the generated documents used APP_URL. These tests pin the
 * resolution order and fail if a second address is written down anywhere.
 */

const ROOT = join(__dirname, "..", "..", "..");

const previous = process.env.APP_URL;
afterEach(() => {
  if (previous === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previous;
});

function withAppUrl<T>(value: string | undefined, fn: () => T): T {
  if (value === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = value;
  return fn();
}

describe("resolving the origin", () => {
  it("uses APP_URL when it is set", () => {
    withAppUrl("https://energie-teilen.de", () => {
      expect(configuredOrigin()).toBe("https://energie-teilen.de");
      expect(siteOrigin()).toBe("https://energie-teilen.de");
      expect(siteHost()).toBe("energie-teilen.de");
      expect(absoluteUrl("/")).toBe("https://energie-teilen.de/");
      expect(absoluteUrl("/rechner")).toBe("https://energie-teilen.de/rechner");
    });
  });

  it("strips trailing slashes and surrounding whitespace", () => {
    withAppUrl("  https://energie-teilen.de///  ", () => {
      expect(siteOrigin()).toBe("https://energie-teilen.de");
      expect(absoluteUrl("/api")).toBe("https://energie-teilen.de/api");
    });
  });

  it("falls back to the deployment address only while APP_URL is unset", () => {
    withAppUrl(undefined, () => {
      expect(configuredOrigin()).toBeNull();
      expect(siteOrigin()).toBe(ORIGIN_FALLBACK);
    });
    withAppUrl("   ", () => {
      expect(configuredOrigin()).toBeNull();
    });
  });

  it("carries the configured origin into the sitemap and robots.txt", () => {
    withAppUrl("https://energie-teilen.de", () => {
      const xml = buildSitemap("2026-09-12");
      expect(xml).toContain("<loc>https://energie-teilen.de/</loc>");
      expect(xml).not.toContain(ORIGIN_FALLBACK);
      expect(buildRobots()).toContain("Sitemap: https://energie-teilen.de/sitemap.xml");
    });
  });

  it("reports the configured origin to Plausible before the current host", () => {
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      location: { hostname: "energie-teilen-site-git-preview.vercel.app" },
    };
    try {
      withAppUrl("https://energie-teilen.de", () => {
        expect(analyticsDomain()).toBe("energie-teilen.de");
      });
      withAppUrl(undefined, () => {
        expect(analyticsDomain()).toBe("energie-teilen-site-git-preview.vercel.app");
      });
    } finally {
      if (original === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = original;
    }
  });
});

// ----------------------------------------------------------------------------
// The guard: one literal, in one file.
// ----------------------------------------------------------------------------

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".git"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const SHIPPED = [
  ...["client/src", "client/public", "server", "shared", "scripts", "api"].flatMap((d) =>
    walk(join(ROOT, d)),
  ),
  join(ROOT, "client", "index.html"),
  join(ROOT, "vite.config.ts"),
]
  .filter((f) => /\.(ts|tsx|mjs|html|txt|xml|webmanifest)$/.test(f) && !/\.test\.ts$/.test(f))
  .map((f) => relative(ROOT, f).split("\\").join("/"));

/** The only file allowed to spell the fallback out. */
const ORIGIN_REGISTER = "shared/routes.ts";

describe("no second address", () => {
  it("scans the files that can publish an address", () => {
    expect(SHIPPED.length).toBeGreaterThan(60);
    expect(SHIPPED).toContain("client/index.html");
    expect(SHIPPED).toContain("client/src/lib/report-pdf.ts");
    expect(SHIPPED).toContain("scripts/build-discovery.mjs");
  });

  it("writes the deployment address only in the origin register", () => {
    const host = ORIGIN_FALLBACK.replace(/^https?:\/\//, "");
    const offenders: string[] = [];
    for (const file of SHIPPED) {
      if (file === ORIGIN_REGISTER) continue;
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes(host)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the static shell's own URLs on the token the build substitutes", () => {
    const html = readFileSync(join(ROOT, "client", "index.html"), "utf8");
    // Everything the page says about itself.
    for (const pattern of [
      /<link rel="canonical" href="%SITE_ORIGIN%\//,
      /hreflang="de-DE" href="%SITE_ORIGIN%\//,
      /hreflang="x-default" href="%SITE_ORIGIN%\//,
      /property="og:url" content="%SITE_ORIGIN%\//,
      /property="og:image" content="%SITE_ORIGIN%\//,
      /name="twitter:image" content="%SITE_ORIGIN%\//,
    ]) {
      expect(html, String(pattern)).toMatch(pattern);
    }
    // Structured data identifies the site by the same address.
    expect(html).toContain('"@id": "%SITE_ORIGIN%/#organization"');
    expect(html).toContain('"@id": "%SITE_ORIGIN%/#website"');

    // The only absolute URLs left are third parties the page genuinely uses.
    const externals = [...html.matchAll(/https?:\/\/[^"' <)]+/g)].map((m) => m[0]);
    for (const url of externals) {
      expect(
        ["https://schema.org", "https://js.stripe.com", "https://checkout.stripe.com"].some((allowed) =>
          url.startsWith(allowed),
        ),
        url,
      ).toBe(true);
    }
  });

  it("substitutes the token in the build and in dev, from the same function", () => {
    const config = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(config).toMatch(/import \{ siteOrigin \} from "\.\/shared\/routes"/);
    expect(config).toContain("%SITE_ORIGIN%");
    expect(config).toContain("__APP_ORIGIN__");
  });

  it("builds every generated document from the same origin function", () => {
    for (const file of ["scripts/build-static.mjs", "scripts/build-discovery.mjs"]) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).toContain("manifests.siteOrigin()");
    }
    expect(readFileSync(join(ROOT, "scripts", "manifest-entry.ts"), "utf8")).toContain("siteOrigin");
  });

  it("ships no static robots.txt or sitemap.xml that the build would have to overwrite", () => {
    // Both are generated from the route manifest and the origin. A checked-in
    // copy served a four-route sitemap on the wrong host whenever the
    // generator did not run.
    expect(SHIPPED).not.toContain("client/public/robots.txt");
    expect(SHIPPED).not.toContain("client/public/sitemap.xml");
  });
});
