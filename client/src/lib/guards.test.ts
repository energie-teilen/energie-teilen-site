import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { securityHeaders, contentSecurityPolicy } from "../../../server/security-headers";

/**
 * Build guards.
 *
 * Each of these encodes a defect that was actually found in this repository
 * and fixed. They exist so the same defect cannot return quietly — a guard
 * that was never triggered by a real bug is usually guarding the wrong thing.
 */

const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", "test-results", "audit", "playwright-report"].includes(name)) {
      continue;
    }
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const ALL_FILES = walk(ROOT);
const CLIENT_SOURCE = ALL_FILES.filter(
  (f) => f.includes(`${join("client", "src")}`) && /\.tsx?$/.test(f) && !f.endsWith(".test.ts"),
);

describe("no template placeholders reach a visitor", () => {
  /*
   * The imprint, the privacy notice and the terms each shipped with bracketed
   * placeholders — "[FIRMENNAME]", "[STRASSE UND HAUSNUMMER]" — and with notes
   * addressed to the operator rather than the reader.
   */
  it("no rendered string contains a bracketed placeholder", () => {
    const offenders: string[] = [];
    for (const file of CLIENT_SOURCE) {
      const body = readFileSync(file, "utf8");
      body.split("\n").forEach((line, i) => {
        // Skip comments; the guard is about what renders.
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        const m = /\[[A-ZÄÖÜ][A-ZÄÖÜ0-9 /:.-]{3,}\]/.exec(code);
        if (m) offenders.push(`${file.replace(ROOT + "/", "")}:${i + 1} ${m[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no page tells the reader the text is a draft", () => {
    const offenders: string[] = [];
    for (const file of CLIENT_SOURCE) {
      const body = readFileSync(file, "utf8");
      body.split("\n").forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (/Strukturentwurf|anwaltlich (prüfen|ausarbeiten|finalisieren)/i.test(code)) {
          offenders.push(`${file.replace(ROOT + "/", "")}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("no third-party font transfer", () => {
  /*
   * Loading a stylesheet from a font CDN transmits every visitor's IP address
   * to that provider on first paint, before any consent is possible.
   */
  const html = readFileSync(join(ROOT, "client", "index.html"), "utf8");

  it("the document loads no external font host", () => {
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com", "use.typekit.net", "fonts.bunny.net"]) {
      expect(html.includes(host), `${host} referenced in index.html`).toBe(false);
    }
  });

  it("fonts are declared locally", () => {
    const css = readFileSync(join(ROOT, "client", "src", "fonts.css"), "utf8");
    expect(css).toMatch(/@font-face/);
    expect(css).toMatch(/url\("\/fonts\//);
    expect(css).toMatch(/font-display:\s*swap/);
  });

  it("every family keeps a real fallback stack, so a missing file still reads", () => {
    const css = readFileSync(join(ROOT, "client", "src", "index.css"), "utf8");
    for (const family of ["--font-display", "--font-body"]) {
      const line = css.split("\n").find((l) => l.includes(family)) ?? "";
      expect(line, `${family} fallback`).toMatch(/system-ui|ui-sans-serif/);
    }
  });
});

describe("security headers", () => {
  it("sets every header the baseline requires", () => {
    const headers = securityHeaders({ hsts: true });
    for (const name of [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
      "Cross-Origin-Opener-Policy",
    ]) {
      expect(headers[name], `${name} missing`).toBeTruthy();
    }
  });

  it("omits HSTS where it would be wrong rather than sending it always", () => {
    expect(securityHeaders({ hsts: false })["Strict-Transport-Security"]).toBeUndefined();
  });

  it("does not weaken the policy to make things work", () => {
    const csp = contentSecurityPolicy();
    expect(csp, "script-src must not allow inline script").not.toMatch(
      /script-src[^;]*'unsafe-inline'/,
    );
    expect(csp, "script-src must not allow eval").not.toMatch(/'unsafe-eval'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'self'/);
    // Fonts are self-hosted; permitting a font CDN here would re-open the
    // transfer the guard above removed.
    expect(csp, "font-src must not allow an external host").not.toMatch(/font-src[^;]*https:/);
  });

  it("names every host it allows", () => {
    const csp = contentSecurityPolicy();
    const hosts = [...csp.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]);
    const allowed = new Set(["https://plausible.io", "https://api.stripe.com"]);
    for (const host of hosts) expect(allowed.has(host), `unexpected host ${host}`).toBe(true);
  });
});

describe("legal pages stay inside the site", () => {
  const pages = ["Impressum", "Datenschutz", "Agb"];

  it("each legal page renders inside the shared layout", () => {
    for (const page of pages) {
      const body = readFileSync(join(ROOT, "client", "src", "pages", "legal", `${page}.tsx`), "utf8");
      expect(body, `${page} uses LegalLayout`).toMatch(/LegalLayout/);
    }
  });

  it("the 404 page is in the product's language and links onward", () => {
    const body = readFileSync(join(ROOT, "client", "src", "pages", "NotFound.tsx"), "utf8");
    expect(body).not.toMatch(/Page Not Found|Go Home|doesn't exist/);
    expect(body).toMatch(/<Link/);
    expect(body).toMatch(/Header|Footer/);
  });
});
