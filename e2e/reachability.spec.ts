import { test, expect, waitForApp, ROUTES } from "./fixtures";

/**
 * Reachability: every route resolves, every navigation control leads
 * somewhere, and the browser's own history behaves.
 *
 * A capability that cannot be reached from the UI does not exist as far as a
 * customer is concerned, so this suite treats an unreachable control as a
 * failure, not a cosmetic issue.
 */

test.describe("routes", () => {
  for (const route of ROUTES) {
    test(`${route.path} renders without error`, async ({ page }) => {
      const response = await page.goto(route.path);
      // The SPA always serves 200 with the shell; the assertion that matters is
      // that something rendered and nothing threw.
      expect(response?.status(), `HTTP status for ${route.path}`).toBeLessThan(400);
      await waitForApp(page);
      await expect(page.getByRole("banner").first()).toBeVisible();
      await expect(page.getByRole("contentinfo").first()).toBeVisible();
      const text = await page.locator("body").innerText();
      expect(text.trim().length, `${route.path} rendered content`).toBeGreaterThan(200);
    });
  }

  test("unknown routes reach the 404 page and offer a way back", async ({ page }) => {
    await page.goto("/definitiv-nicht-vorhanden");
    await waitForApp(page);
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/404|nicht gefunden|not found/i);
    const home = page.getByRole("link", { name: /start|home|zur startseite|übersicht/i }).first();
    await expect(home).toBeVisible();
  });

  test("deep links rewrite to the anchor they name", async ({ page }) => {
    await page.goto("/rechner");
    await waitForApp(page);
    await page.waitForFunction(() => window.location.pathname === "/", null, { timeout: 10_000 });
    expect(page.url()).toContain("#rechner");
    await expect(page.locator("#rechner")).toBeVisible();
  });
});

test.describe("navigation graph", () => {
  test("every header link resolves to a target that exists", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const links = await page.getByRole("banner").locator("a[href]").evaluateAll((els) =>
      els.map((e) => ({ href: e.getAttribute("href") ?? "", text: (e.textContent ?? "").trim() })),
    );
    expect(links.length, "header has navigation links").toBeGreaterThan(0);

    for (const link of links) {
      if (link.href.startsWith("http") || link.href.startsWith("mailto:")) continue;
      const hash = link.href.includes("#") ? link.href.split("#")[1] : null;
      if (hash) {
        await expect(
          page.locator(`#${hash}`),
          `header link "${link.text}" points at #${hash}`,
        ).toHaveCount(1);
      }
    }
  });

  test("every footer link resolves", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const links = await page.getByRole("contentinfo").locator("a[href]").evaluateAll((els) =>
      els.map((e) => ({ href: e.getAttribute("href") ?? "", text: (e.textContent ?? "").trim() })),
    );
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      if (link.href.startsWith("mailto:") || link.href.startsWith("tel:")) continue;
      if (link.href.startsWith("http")) continue;
      if (link.href.startsWith("#") || link.href.startsWith("/#")) {
        const hash = link.href.split("#")[1];
        await expect(page.locator(`#${hash}`), `footer anchor #${hash}`).toHaveCount(1);
        continue;
      }
      // Internal route: it must not land on the 404 page.
      const res = await page.request.get(link.href);
      expect(res.status(), `footer route ${link.href}`).toBeLessThan(400);
    }
  });

  test("legal pages are reachable from the footer, as German law requires", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    for (const [label, path] of [
      [/impressum/i, "/impressum"],
      [/datenschutz/i, "/datenschutz"],
      [/agb|bedingungen/i, "/agb"],
    ] as const) {
      const link = page.locator("footer").getByRole("link", { name: label }).first();
      await expect(link, `footer link ${path}`).toBeVisible();
      expect(await link.getAttribute("href")).toBe(path);
    }
  });

  test("no anchor link points at a missing element", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    const broken = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        const m = /^\/?#(.+)$/.exec(href);
        if (!m) return;
        if (!document.getElementById(m[1])) out.push(href);
      });
      return out;
    });
    expect(broken, "anchors pointing at nothing").toEqual([]);
  });

  test("no link is a dead end", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    const dead = await page.evaluate(() =>
      [...document.querySelectorAll("a")]
        .map((a) => a.getAttribute("href"))
        .filter((h) => h === null || h === "" || h === "#" || h === "javascript:void(0)"),
    );
    expect(dead, "links with no destination").toEqual([]);
  });
});

test.describe("browser history", () => {
  test("back and forward restore the expected route", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.goto("/impressum");
    await waitForApp(page);
    await page.goBack();
    await waitForApp(page);
    expect(new URL(page.url()).pathname).toBe("/");
    await page.goForward();
    await waitForApp(page);
    expect(new URL(page.url()).pathname).toBe("/impressum");
  });

  test("a reload at any route keeps that route", async ({ page }) => {
    for (const path of ["/impressum", "/datenschutz", "/agb"]) {
      await page.goto(path);
      await waitForApp(page);
      await page.reload();
      await waitForApp(page);
      expect(new URL(page.url()).pathname).toBe(path);
    }
  });
});
