import { test, expect, waitForApp } from "./fixtures";
import { readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Performance, treated as a product property with a budget rather than as a
 * number somebody looks at occasionally.
 *
 * The budgets are set slightly above the current measurements, so an
 * accidental regression fails rather than being absorbed silently. They are
 * deliberately not set at the theoretical ideal: a budget nobody can meet gets
 * raised, and then it protects nothing.
 */

const ASSET_DIR = join(process.cwd(), "dist", "public", "assets");

/** Uncompressed bytes; the served size is roughly a third of this. */
const BUDGETS = {
  /** Anything loaded before the page is interactive. */
  initialJsBytes: 600_000,
  /** Any single chunk. A larger one should be split. */
  largestChunkBytes: 470_000,
  cssBytes: 200_000,
};

test.describe("bundle budget", () => {
  test("the built assets stay within budget", () => {
    const files = readdirSync(ASSET_DIR).filter((f) => !f.endsWith(".map"));
    const js = files.filter((f) => f.endsWith(".js"));
    const css = files.filter((f) => f.endsWith(".css"));

    const size = (f: string) => statSync(join(ASSET_DIR, f)).size;
    const largest = js.map(size).sort((a, b) => b - a)[0] ?? 0;
    const cssTotal = css.reduce((s, f) => s + size(f), 0);

    expect(largest, `largest JS chunk (${(largest / 1024).toFixed(0)} kB)`).toBeLessThan(
      BUDGETS.largestChunkBytes,
    );
    expect(cssTotal, `CSS (${(cssTotal / 1024).toFixed(0)} kB)`).toBeLessThan(BUDGETS.cssBytes);
  });

  test("the heavy libraries are not on the critical path", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "script") requested.push(r.url());
    });

    await page.goto("/");
    await waitForApp(page);

    // The PDF generator and the chart library are only needed further down the
    // funnel; loading them for a first visit costs every visitor.
    // generateCategoricalChart is recharts' own entry after code splitting.
    const eager = requested.filter((u) =>
      /report-pdf|html2canvas|recharts|generateCategoricalChart/.test(u),
    );
    expect(eager, "deferred libraries loaded eagerly").toEqual([]);
  });
});

test.describe("runtime", () => {
  test("first contentful paint happens promptly on a warm cache", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    const fcp = await page.evaluate(() => {
      const entry = performance.getEntriesByName("first-contentful-paint")[0];
      return entry ? entry.startTime : null;
    });
    expect(fcp, "FCP was not measurable").not.toBeNull();
    expect(fcp!, `FCP ${fcp?.toFixed(0)}ms`).toBeLessThan(3000);
  });

  test("the layout does not shift after load", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
              if (!e.hadRecentInput) total += e.value;
            }
          });
          try {
            observer.observe({ type: "layout-shift", buffered: true });
          } catch {
            resolve(0);
            return;
          }
          setTimeout(() => {
            observer.disconnect();
            resolve(total);
          }, 2500);
        }),
    );
    expect(cls, `cumulative layout shift ${cls.toFixed(3)}`).toBeLessThan(0.1);
  });

  test("moving a calculator input stays responsive", async ({ page }) => {
    await page.goto("/#rechner");
    await waitForApp(page);
    const slider = page.locator('#rechner input[type="range"]').first();
    await slider.focus();

    const elapsed = await page.evaluate(async () => {
      const start = performance.now();
      const el = document.activeElement as HTMLInputElement;
      for (let i = 0; i < 20; i++) {
        el.value = String(Number(el.value) + 1);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - start;
    });

    // Twenty consecutive recalculations of three scenarios plus every panel.
    expect(elapsed, `${elapsed.toFixed(0)}ms for 20 input events`).toBeLessThan(2000);
  });

  test("no request is made to a third-party font host", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/.test(url)) external.push(url);
    });
    await page.goto("/");
    await waitForApp(page);
    expect(external, "visitor IP transferred to a font provider").toEqual([]);
  });
});
