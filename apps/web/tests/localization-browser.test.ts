import { expect, test } from "bun:test";

import { copyBrowser } from "./copy-browser-fixture";

test("web follows German, persists an English device override, and returns to the system language", async () => {
  const ui = await copyBrowser("", "de-DE");
  const failures: string[] = [];
  ui.context.on("page", (page) => {
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => {
      if (
        response.request().resourceType() === "document" &&
        response.status() >= 400
      ) {
        failures.push(`Document returned ${response.status()}`);
      }
    });
  });
  try {
    const page = await ui.open();
    await page
      .getByRole("heading", {
        name: "Der Ort, an dem deine besten Prompts leben.",
      })
      .waitFor();
    expect(await page.locator("html").getAttribute("lang")).toBe("de");
    await page
      .getByText(
        "Suchen, kopieren, weiterarbeiten. Auf dem Desktop, im Browser, überall synchron.",
        { exact: true }
      )
      .waitFor();
    let attempts = 0;
    await page.route("**/api/auth/sign-in/email", async (route) => {
      attempts += 1;
      await route.fulfill({
        status: 429,
        json: { code: "rate_limited", retryAfter: 17 },
      });
    });
    await page
      .getByLabel("E-Mail", { exact: true })
      .fill("language@example.com");
    await page
      .getByLabel("Passwort", { exact: true })
      .fill("localization-test-password");
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page
      .getByText("Zu viele Versuche. Versuche es in 17 Sekunden erneut.", {
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("combobox", { name: "Sprache auf diesem Gerät" })
      .selectOption("en");
    await page
      .getByText("Too many attempts. Try again in 17 seconds.", { exact: true })
      .waitFor();
    expect(attempts).toBe(1);
    await page
      .getByRole("heading", { name: "The place where your best prompts live." })
      .waitFor();
    await page.reload();
    await page
      .getByRole("heading", { name: "The place where your best prompts live." })
      .waitFor();
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
    await page
      .getByRole("combobox", { name: "Language on this device" })
      .selectOption("system");
    await page
      .getByRole("heading", {
        name: "Der Ort, an dem deine besten Prompts leben.",
      })
      .waitFor();
    expect(failures).toEqual([]);
  } finally {
    await ui.browser.close();
  }
});

test("web falls back to English for an unsupported system language", async () => {
  const ui = await copyBrowser("", "fr-FR");
  try {
    const page = await ui.open();
    await page
      .getByRole("heading", { name: "The place where your best prompts live." })
      .waitFor();
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
  } finally {
    await ui.browser.close();
  }
});
