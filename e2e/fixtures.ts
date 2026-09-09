import { test as base, expect, type Page, type ConsoleMessage } from "@playwright/test";

/** The plaintext of the key whose hash the webServer is configured with. */
export const E2E_API_KEY = "et_e2e_test_key_0123456789abcdef";

export const ROUTES = [
  { path: "/", name: "Home" },
  { path: "/rechner", name: "Rechner deep link", redirectsTo: "/" },
  { path: "/pilot", name: "Pilot deep link", redirectsTo: "/" },
  { path: "/impressum", name: "Impressum" },
  { path: "/datenschutz", name: "Datenschutz" },
  { path: "/agb", name: "AGB" },
  { path: "/404", name: "NotFound" },
  { path: "/gibt-es-nicht", name: "Unknown route falls through to NotFound" },
] as const;

/**
 * Console and page errors are collected for EVERY test and asserted at
 * teardown. A page that renders correctly while throwing in the console is not
 * a page that works.
 *
 * Known-benign noise is filtered by explicit pattern, never by muting the
 * whole channel.
 */
const IGNORED_CONSOLE = [
  /favicon/i,
  /Download the React DevTools/i,
  // Analytics and fonts are blocked by the sandbox egress proxy, not broken.
  /plausible/i,
  /ERR_TUNNEL_CONNECTION_FAILED/i,
  /net::ERR_(BLOCKED|FAILED|NAME_NOT_RESOLVED|CONNECTION_REFUSED)/i,
  /Failed to load resource/i,
  /fonts\.(googleapis|gstatic)/i,
];

export type PageDiagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; failure: string }[];
};

export function attachDiagnostics(page: Page): PageDiagnostics {
  const diagnostics: PageDiagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [] };

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    if (msg.type() === "error") diagnostics.consoleErrors.push(text);
  });

  page.on("pageerror", (err) => {
    diagnostics.pageErrors.push(`${err.name}: ${err.message}`);
  });

  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "unknown";
    if (IGNORED_CONSOLE.some((re) => re.test(failure) || re.test(req.url()))) return;
    diagnostics.failedRequests.push({ url: req.url(), failure });
  });

  return diagnostics;
}

export const test = base.extend<{ diagnostics: PageDiagnostics }>({
  diagnostics: async ({ page }, use) => {
    const d = attachDiagnostics(page);
    await use(d);
    expect(d.pageErrors, "uncaught page errors").toEqual([]);
    expect(d.consoleErrors, "console errors").toEqual([]);
  },
});

export { expect };

/** Wait for the app shell to have hydrated past the Suspense fallback. */
export async function waitForApp(page: Page): Promise<void> {
  // The banner landmark, not any <header>: a page-title <header> inside <main>
  // is valid markup and would make a bare tag selector ambiguous.
  await page.getByRole("banner").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => !document.body.textContent?.includes("wird vorbereitet"), null, {
    timeout: 20_000,
  });
}
