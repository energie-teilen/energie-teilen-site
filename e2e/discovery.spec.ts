import { test, expect, waitForApp, INDEXABLE_PATHS } from "./fixtures";

/**
 * Discovery.
 *
 * A capability nobody can find does not exist commercially. Every engine in
 * this repository was previously reachable only by scrolling one long page,
 * which meant none of them could be indexed, linked to from an answer, or rank
 * for the question it answers.
 *
 * These checks are about the SERVED document, before any JavaScript runs:
 * that is what a crawler, a link preview and a chat unfurl actually read.
 */

test.describe("each route is its own document", () => {
  for (const path of INDEXABLE_PATHS) {
    test(`${path} is served with its own title and canonical`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status(), `${path} status`).toBe(200);
      const html = await res.text();

      const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1]?.trim() ?? "";
      const canonical = /rel="canonical"\s+href="([^"]+)"/.exec(html)?.[1] ?? "";
      const description = /name="description"\s+content="([^"]*)"/.exec(html)?.[1] ?? "";

      expect(title.length, `${path} has a title`).toBeGreaterThan(8);
      expect(canonical, `${path} canonical`).toMatch(new RegExp(`${path === "/" ? "/" : path}$`));
      expect(description.length, `${path} description`).toBeGreaterThan(40);
    });
  }

  test("no two pages claim the same title", async ({ request }) => {
    const titles = new Map<string, string>();
    for (const path of INDEXABLE_PATHS) {
      const html = await (await request.get(path)).text();
      const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1]?.trim() ?? "";
      const existing = titles.get(title);
      expect(existing, `${path} and ${existing} share the title "${title}"`).toBeUndefined();
      titles.set(title, path);
    }
  });

  test("no two pages claim the same canonical URL", async ({ request }) => {
    const seen = new Set<string>();
    for (const path of INDEXABLE_PATHS) {
      const html = await (await request.get(path)).text();
      const canonical = /rel="canonical"\s+href="([^"]+)"/.exec(html)?.[1] ?? path;
      expect(seen.has(canonical), `${canonical} claimed twice`).toBe(false);
      seen.add(canonical);
    }
  });

  test("every page carries structured data", async ({ request }) => {
    for (const path of INDEXABLE_PATHS) {
      const html = await (await request.get(path)).text();
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks.length, `${path} JSON-LD blocks`).toBeGreaterThanOrEqual(1);
      for (const [, body] of blocks) {
        // Invalid JSON-LD is worse than none: it is ignored silently.
        expect(() => JSON.parse(body), `${path} JSON-LD parses`).not.toThrow();
      }
    }
  });

  test("the served page does not point at the landing page's URL", async ({ request }) => {
    // The failure this guards against: one shell for every route, so every
    // page advertised the landing page's title and canonical.
    const html = await (await request.get("/messkonzept")).text();
    expect(html).not.toMatch(/rel="canonical"\s+href="[^"]*\.app\/"/);
  });
});

test.describe("sitemap and robots", () => {
  test("the sitemap lists every indexable route", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const path of INDEXABLE_PATHS) {
      expect(xml, `${path} in sitemap`).toContain(path === "/" ? ".app/</loc>" : `${path}</loc>`);
    }
    expect((xml.match(/<url>/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  test("the sitemap does not list the 404 page", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).not.toContain("/404</loc>");
  });

  test("robots.txt points at the sitemap", async ({ request }) => {
    const txt = await (await request.get("/robots.txt")).text();
    expect(txt).toContain("Sitemap:");
    expect(txt).toContain("/sitemap.xml");
  });
});

test.describe("the tools work on their own routes", () => {
  test("the metering tool computes from its own inputs", async ({ page }) => {
    await page.goto("/messkonzept");
    await waitForApp(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Messkonzept/i);
    await page.getByRole("button", { name: /Ein gemeinsamer Hausanschluss/i }).click();
    await expect(page.getByText(/Summenzählermodell/i).first()).toBeVisible();
    await expect(page.locator('svg[aria-label^="Schema"]')).toBeVisible();
  });

  test("the allocation tool compares the keys", async ({ page }) => {
    await page.goto("/aufteilungsschluessel");
    await waitForApp(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Aufteilungsschlüssel/i);
    await expect(page.getByRole("button", { name: /Nachverteilung/ }).first()).toBeVisible();
    await expect(page.locator('svg[aria-label^="Zuordnung"]')).toBeVisible();
  });

  test("the market-communication page shows the clock-change grid", async ({ page }) => {
    await page.goto("/marktkommunikation");
    await waitForApp(page);
    await page.getByRole("button", { name: /Zeitumstellung Oktober/ }).click();
    await expect(page.getByText("100 Viertelstunden").first()).toBeVisible();
    await expect(page.getByText(/Syntaxprüfung/i).first()).toBeVisible();
  });

  test("the API reference documents every endpoint with a runnable example", async ({ page }) => {
    await page.goto("/api");
    await waitForApp(page);
    const body = await page.locator("main").innerText();
    for (const path of [
      "/api/v1/meta",
      "/api/v1/calculate",
      "/api/v1/eligibility",
      "/api/v1/messkonzept",
      "/api/v1/allocation",
      "/api/v1/billing",
      "/api/v1/mako/grid",
      "/api/v1/mako/identifiers",
      "/api/v1/mako/mscons",
    ]) {
      expect(body, `${path} documented`).toContain(path);
    }
    expect(body).toContain("curl");
  });

  test("every tool page links onward", async ({ page }) => {
    for (const path of ["/messkonzept", "/aufteilungsschluessel", "/marktkommunikation", "/api"]) {
      await page.goto(path);
      await waitForApp(page);
      const related = page.locator("main").getByRole("link", { name: /Öffnen/ });
      expect(await related.count(), `${path} offers a next step`).toBeGreaterThan(0);
    }
  });

  test("the tools are reachable from the header on every viewport", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    // Below the large breakpoint the links live behind the menu button, which
    // is a valid pattern — but they still have to be reachable.
    const banner = page.getByRole("banner");
    const desktopNav = banner.getByRole("navigation", { name: /Primäre Navigation/i });
    if (!(await desktopNav.isVisible())) {
      await banner.getByRole("button", { name: /Navigation öffnen/i }).click();
    }

    for (const label of [/Messkonzept/, /Aufteilung/, /Marktkommunikation/, /API/]) {
      await expect(
        banner.getByRole("link", { name: label }).first(),
        `header offers ${label}`,
      ).toBeVisible();
    }
  });
});

test.describe("the machine-readable surface", () => {
  const FILES = [
    { path: "/llms.txt", type: /text\/plain/ },
    { path: "/llms-full.txt", type: /text\/plain/ },
    { path: "/openapi.json", type: /application\/json/ },
    { path: "/.well-known/mcp.json", type: /application\/json/ },
    { path: "/mcp.json", type: /application\/json/ },
    { path: "/ai.txt", type: /text\/plain/ },
  ];

  for (const file of FILES) {
    test(`${file.path} is served`, async ({ request }) => {
      const res = await request.get(file.path);
      expect(res.status(), file.path).toBe(200);
      expect(res.headers()["content-type"], file.path).toMatch(file.type);
      expect((await res.text()).length, file.path).toBeGreaterThan(200);
    });
  }

  test("llms.txt links only to pages that exist", async ({ request }) => {
    // A model that follows a dead link from the index learns the site is
    // unreliable, which is worse than not being indexed at all.
    const txt = await (await request.get("/llms.txt")).text();
    const paths = [...txt.matchAll(/\]\(https?:\/\/[^/)]+(\/[^)\s]*)\)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(5);
    for (const path of new Set(paths)) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });

  test("llms-full.txt carries the facts, not just the links", async ({ request }) => {
    const txt = await (await request.get("/llms-full.txt")).text();
    // The three things that are true here and guessed everywhere else.
    expect(txt).toContain("92");
    expect(txt).toContain("100");
    expect(txt).toMatch(/Cent/);
    expect(txt).toMatch(/not_determinable|verweiger|Verweiger/);
    expect(txt.length).toBeGreaterThan(8000);
  });

  test("openapi.json describes exactly the endpoints that exist", async ({ request }) => {
    const spec = await (await request.get("/openapi.json")).json();
    expect(spec.openapi).toMatch(/^3\.1/);
    for (const path of [
      "/api/v1/meta",
      "/api/v1/calculate",
      "/api/v1/eligibility",
      "/api/v1/messkonzept",
      "/api/v1/allocation",
      "/api/v1/billing",
      "/api/v1/mako/grid",
      "/api/v1/mako/identifiers",
      "/api/v1/mako/mscons",
    ]) {
      expect(Object.keys(spec.paths), `${path} in spec`).toContain(path);
    }
    // Every operation an agent might call must state how to authenticate and
    // what a refusal looks like.
    for (const [path, ops] of Object.entries(spec.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>)) {
      for (const [verb, op] of Object.entries(ops)) {
        expect(op.responses["401"], `${verb} ${path} documents 401`).toBeTruthy();
        expect(op.responses["400"], `${verb} ${path} documents 400`).toBeTruthy();
      }
    }
    expect(spec.components.securitySchemes).toBeTruthy();
  });

  test("openapi.json publishes the schema the server enforces", async ({ request }) => {
    const spec = await (await request.get("/openapi.json")).json();
    // A spec with an empty request body teaches an agent nothing and costs it
    // a round trip per guess.
    const calculate = spec.paths["/api/v1/calculate"].post.requestBody.content["application/json"].schema;
    expect(calculate.type).toBe("object");
    expect(calculate.required).toContain("inputs");

    const grid = spec.paths["/api/v1/mako/grid"].get;
    expect(grid.parameters.map((p: { name: string }) => p.name)).toContain("date");
  });

  test("the MCP manifest points at an endpoint that answers", async ({ request }) => {
    const manifest = await (await request.get("/.well-known/mcp.json")).json();
    expect(manifest.transport.type).toBe("streamable-http");
    expect(manifest.transport.url).toMatch(/\/mcp$/);
    expect(manifest.authentication.type).toBe("bearer");
    expect(manifest.tools.length).toBeGreaterThanOrEqual(8);
    for (const tool of manifest.tools) {
      // Every tool must also be reachable without MCP, so a plain HTTP client
      // is not shut out.
      expect(tool.httpEquivalent.path, tool.name).toMatch(/^\/api\/v1\//);
      expect(tool.inputSchema.type, tool.name).toBe("object");
    }
  });

  test("the root copy of the manifest matches the well-known copy", async ({ request }) => {
    const wellKnown = await (await request.get("/.well-known/mcp.json")).text();
    const root = await (await request.get("/mcp.json")).text();
    expect(root).toBe(wellKnown);
  });

  test("robots.txt names the AI crawlers explicitly", async ({ request }) => {
    // Several of these default to not crawling unless named. Being absent from
    // this list is being absent from the answer.
    const txt = await (await request.get("/robots.txt")).text();
    for (const agent of [
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-User",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
    ]) {
      expect(txt, `${agent} named`).toContain(agent);
    }
    expect(txt).not.toMatch(/^Disallow: \/$/m);
  });

  test("ai.txt states the terms rather than leaving them to be assumed", async ({ request }) => {
    const txt = await (await request.get("/ai.txt")).text();
    expect(txt).toMatch(/llms\.txt/);
    expect(txt).toMatch(/openapi\.json/);
  });
});
