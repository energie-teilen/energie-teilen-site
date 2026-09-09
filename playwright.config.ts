import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * The suite runs against a PRODUCTION BUILD served by the real Express server,
 * not the dev server: the thing that ships is the thing that gets tested.
 *
 * Traces, screenshots and video are retained on failure so a red run is
 * diagnosable rather than merely red.
 *
 * Firefox and WebKit are declared but only run where their binaries are
 * available. In a sandbox without browser downloads the run is Chromium-only
 * and reports itself as such rather than silently skipping coverage.
 */

const PORT = Number(process.env.E2E_PORT ?? 4321);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const ONLY_CHROMIUM = process.env.E2E_ONLY_CHROMIUM === "1";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_PATH;

/**
 * Chromium's own background traffic (autofill, component updates, safe
 * browsing) is irrelevant to these tests and, behind a restrictive egress
 * proxy, turns into slow rejected connections that dominate the run time.
 */
const chromiumLaunch = {
  ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
  args: [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=AutofillServerCommunication,OptimizationHints,MediaRouter,Translate",
  ],
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "audit/e2e-results.json" }]]
    : [["list"], ["json", { outputFile: "audit/e2e-results.json" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: "chromium-tablet",
      use: {
        ...devices["Galaxy Tab S4"],
        launchOptions: chromiumLaunch,
      },
    },
    ...(ONLY_CHROMIUM
      ? []
      : [
          { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
          { name: "webkit-mobile", use: { ...devices["iPhone 14"] } },
        ]),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `node dist/index.js`,
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          NODE_ENV: "production",
          PORT: String(PORT),
          // A known key so the API suite can authenticate. Test-only.
          ET_API_KEYS: "e2e:ae8431e3c6e3a88e100b3129e0ddf0aaed08b03d5fa8c82c423e8a0e8ec3f0de",
        },
      },
});
