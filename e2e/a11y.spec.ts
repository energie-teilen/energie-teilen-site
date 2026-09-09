import AxeBuilder from "@axe-core/playwright";
import { test, expect, waitForApp, ROUTES } from "./fixtures";

/**
 * Accessibility. Automated scanning cannot find every barrier, so this suite
 * covers what a machine can establish — WCAG 2.2 A and AA rule violations,
 * keyboard reachability and focus visibility — and the remaining manual
 * findings are recorded in the audit report rather than implied to be absent.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page }).withTags(TAGS).analyze();
}

for (const route of ROUTES.filter((r) => !("redirectsTo" in r))) {
  test(`${route.path} has no automatically detectable WCAG violations`, async ({ page }) => {
    await page.goto(route.path);
    await waitForApp(page).catch(() => {});
    const results = await scan(page);
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      serious.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`),
      `serious/critical violations on ${route.path}`,
    ).toEqual([]);
    expect(
      results.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`),
      `all violations on ${route.path}`,
    ).toEqual([]);
  });
}

test("the calculator, once interacted with, stays accessible", async ({ page }) => {
  await page.goto("/#rechner");
  await waitForApp(page);
  await page.getByRole("button", { name: /Ein gemeinsamer Hausanschluss/i }).click();
  await page.getByRole("button", { name: /Dynamisch/ }).first().click();
  const results = await scan(page);
  expect(results.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`)).toEqual([]);
});

test("every interactive control is reachable by keyboard", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);
  const unreachable = await page.evaluate(() => {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea';
    return [...document.querySelectorAll(selector)]
      .filter((el) => {
        const t = el.getAttribute("tabindex");
        if (t === null || Number(t) >= 0) return false;
        // Hidden from everyone, deliberately: the spam honeypot, chart
        // tooltip wrappers, and the toast region are not user controls.
        if (el.getAttribute("aria-hidden") === "true") return false;
        if ((el as HTMLElement).offsetParent === null) return false;
        return true;
      })
      .map((el) => el.outerHTML.slice(0, 140));
  });
  expect(unreachable, "visible controls removed from the tab order").toEqual([]);
});

test("a skip link is offered before the navigation", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? { tag: el.tagName, text: (el.textContent ?? "").trim(), href: el.getAttribute("href") } : null;
  });
  expect(focused, "something receives focus first").not.toBeNull();
  expect(
    `${focused?.text} ${focused?.href}`,
    "the first tab stop should skip to the main content",
  ).toMatch(/skip|inhalt|hauptinhalt|#main/i);
});

test("focus is visible on the first interactive element", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
  });
  const visible =
    outline !== null &&
    ((outline.outlineStyle !== "none" && outline.outlineWidth !== "0px") ||
      (outline.boxShadow !== "none" && outline.boxShadow !== ""));
  expect(visible, `focus indicator: ${JSON.stringify(outline)}`).toBe(true);
});

test("the page declares its language as German", async ({ page }) => {
  await page.goto("/");
  const lang = await page.locator("html").getAttribute("lang");
  expect(lang).toMatch(/^de/);
});

/*
 * Reduced motion.
 *
 * WCAG 2.3.3 is about MOVEMENT, not about every visual change: a fade is not
 * what triggers vestibular symptoms. So the assertion is that nothing is
 * moving — no transform, translate, scale, rotate or positional animation —
 * while opacity transitions are permitted to continue.
 *
 * Asserting "no animations at all" would fail on correct behaviour and teach
 * the next person to weaken the check rather than fix a real problem.
 */
const MOVEMENT_PROPERTIES = [
  "transform",
  "translate",
  "scale",
  "rotate",
  "top",
  "left",
  "right",
  "bottom",
  "margin",
];

test("nothing moves under prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForApp(page);

  const moving = await page.evaluate((props) => {
    return document
      .getAnimations()
      .filter((a) => {
        const d = a.effect?.getTiming().duration ?? 0;
        if (typeof d !== "number" || d <= 200) return false;
        if (a.playState !== "running") return false;
        let keys: string[] = [];
        try {
          keys = (a.effect as KeyframeEffect)
            .getKeyframes()
            .flatMap((k) => Object.keys(k))
            .filter((k) => !["offset", "composite", "computedOffset", "easing"].includes(k));
        } catch {
          return false;
        }
        return keys.some((k) => props.some((p) => k.toLowerCase().includes(p)));
      })
      .map((a) => {
        const target = a.effect && "target" in a.effect ? (a.effect.target as Element | null) : null;
        return `${target?.tagName ?? "?"}.${String(target?.getAttribute("class") ?? "").slice(0, 60)}`;
      });
  }, MOVEMENT_PROPERTIES);

  expect(moving, "movement animations still running under prefers-reduced-motion").toEqual([]);
});

test("motion is configured to follow the user's preference", async ({ page }) => {
  // Guards the MotionConfig at the app root: without it only CSS transitions
  // honoured the setting and every entrance animation still moved.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForApp(page);
  const transformsAnimating = await page.evaluate(() =>
    document.getAnimations().filter((a) => {
      try {
        return (a.effect as KeyframeEffect)
          .getKeyframes()
          .some((k) => "transform" in k || "translate" in k);
      } catch {
        return false;
      }
    }).length,
  );
  expect(transformsAnimating).toBe(0);
});
