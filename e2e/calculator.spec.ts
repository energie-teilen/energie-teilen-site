import { test, expect, waitForApp } from "./fixtures";

/**
 * The calculator is the entry point to everything that gets paid for, so its
 * controls, its persistence and the panels it drives are tested as a system
 * rather than as isolated widgets.
 */

async function openCalculator(page: import("@playwright/test").Page) {
  await page.goto("/#rechner");
  await waitForApp(page);
  await expect(page.locator("#rechner")).toBeVisible();
}

test.describe("calculator controls", () => {
  test("every range input is operable and moves the result", async ({ page }) => {
    await openCalculator(page);

    const sliders = page.locator('#rechner input[type="range"]');
    const count = await sliders.count();
    expect(count, "calculator exposes sliders").toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const slider = sliders.nth(i);
      await expect(slider).toBeEnabled();
      const before = await slider.inputValue();
      await slider.focus();
      await slider.press("ArrowRight");
      /*
       * A web-first assertion, not a bare read: the calculator commits input
       * changes through a transition, so reading the value immediately races
       * the render and fails on slower devices for reasons that have nothing
       * to do with the control working.
       */
      await expect(slider, `slider ${i} responds to keyboard`).not.toHaveValue(before);
    }
  });

  test("results update when an input changes", async ({ page }) => {
    await openCalculator(page);
    const results = page.locator("#rechner").locator("..");
    const before = await results.innerText();

    const slider = page.locator('#rechner input[type="range"]').first();
    await slider.focus();
    for (let i = 0; i < 12; i++) await slider.press("ArrowRight");
    await page.waitForTimeout(400);

    const after = await results.innerText();
    expect(after, "changing an input changes the output").not.toBe(before);
  });

  test("the constellation survives a reload", async ({ page }) => {
    await openCalculator(page);
    // A labelled economic input, not the break-even explorer: only the
    // constellation itself is meant to persist.
    const slider = page.locator('#rechner input[type="range"]').nth(1);
    await slider.focus();
    for (let i = 0; i < 8; i++) await slider.press("ArrowRight");

    // Persistence is debounced; read the value the app actually stored rather
    // than racing it.
    await page.waitForTimeout(600);
    const value = await slider.inputValue();

    await page.reload();
    await waitForApp(page);
    await expect(page.locator('#rechner input[type="range"]').nth(1)).toHaveValue(value);
  });
});

test.describe("panels driven by the engines", () => {
  test("the qualification verdict renders and names its next step", async ({ page }) => {
    await openCalculator(page);
    await expect(page.getByText(/Einordnung der Konstellation/i)).toBeVisible();
    await expect(page.getByText(/Machbarkeit/i).first()).toBeVisible();
    await expect(page.getByText(/Hauptrisiko/i).first()).toBeVisible();
  });

  test("never says 'contact us' in place of a named next step", async ({ page }) => {
    await openCalculator(page);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/kontaktieren sie uns|nehmen sie kontakt auf/i);
  });

  test("the metering panel refuses to guess without the connection situation", async ({ page }) => {
    await openCalculator(page);
    await expect(page.getByText(/Nicht bestimmbar/i).first()).toBeVisible();
    await page.getByRole("button", { name: /Ein gemeinsamer Hausanschluss/i }).click();
    await expect(page.getByText(/Summenzählermodell/i).first()).toBeVisible();
    await expect(page.locator('svg[aria-label^="Schema"]')).toBeVisible();
  });

  test("the allocation panel compares all three keys", async ({ page }) => {
    await openCalculator(page);
    for (const name of [/Statisch/, /Dynamisch/, /Nachverteilung/]) {
      await expect(page.getByRole("button", { name }).first()).toBeVisible();
    }
    await page.getByRole("button", { name: /Dynamisch/ }).first().click();
    await expect(page.locator('svg[aria-label^="Zuordnung"]')).toBeVisible();
  });

  test("the billing preview reports the saving as undecidable until the tariff is given", async ({ page }) => {
    await openCalculator(page);
    await expect(page.getByText(/nicht bestimmbar/i).first()).toBeVisible();
    const input = page.locator('input[placeholder="unbekannt"]').first();
    await input.fill("36");
    await expect(page.getByText(/Ersparnis je Haushalt und Jahr/i)).toBeVisible();
  });

  test("the market-communication panel changes the interval count with the day", async ({ page }) => {
    await openCalculator(page);
    await page.getByRole("button", { name: /Zeitumstellung März/ }).click();
    await expect(page.getByText("92 Viertelstunden").first()).toBeVisible();
    await page.getByRole("button", { name: /Zeitumstellung Oktober/ }).click();
    await expect(page.getByText("100 Viertelstunden").first()).toBeVisible();
    await page.getByRole("button", { name: /Normaler Tag/ }).click();
    await expect(page.getByText("96 Viertelstunden").first()).toBeVisible();
  });
});

test.describe("lead capture", () => {
  test("rejects an empty submission rather than pretending to succeed", async ({ page }) => {
    await openCalculator(page);
    const form = page.locator("#lead-email").locator("xpath=ancestor::form[1]");
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(1200);

    // Either the browser blocks it or the app reports it — but the form must
    // not report success, and the field must still be there to correct.
    const blocked = await page
      .locator("#lead-email")
      .evaluate((el) => (el as HTMLInputElement).validity.valid === false);
    const body = await page.locator("body").innerText();
    expect(blocked || /E-Mail eingeben|Einwilligung/i.test(body)).toBe(true);
    expect(body).not.toMatch(/erfolgreich versendet|Bericht wurde gesendet/i);
  });

  test("rejects a malformed address", async ({ page }) => {
    await openCalculator(page);
    await page.locator("#lead-email").fill("not-an-email");
    const consent = page.locator("#lead-email").locator("xpath=ancestor::form[1]").locator('input[type="checkbox"]');
    if (await consent.count()) await consent.first().check();
    await page.locator("#lead-email").locator("xpath=ancestor::form[1]").locator('button[type="submit"]').click();
    // Either native validation blocks it, or the app reports it. Never silence.
    const invalid = await page.locator("#lead-email").evaluate(
      (el) => (el as HTMLInputElement).validity.valid === false,
    );
    const message = await page.locator("body").innerText();
    expect(invalid || /ung(ü|ue)ltig|E-Mail/i.test(message)).toBe(true);
  });

  test("survives the lead API failing, without claiming success", async ({ page }) => {
    await page.route("**/api/lead", (route) => route.fulfill({ status: 500, body: "{}" }));
    await openCalculator(page);
    await page.locator("#lead-email").fill("kundin@example.de");
    const form = page.locator("#lead-email").locator("xpath=ancestor::form[1]");
    const consent = form.locator('input[type="checkbox"]');
    if (await consent.count()) await consent.first().check();
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    expect(body, "a failed submission must not read as success").not.toMatch(
      /erfolgreich versendet|Bericht wurde gesendet/i,
    );
  });
});
