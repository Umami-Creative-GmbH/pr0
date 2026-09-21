// oxlint-disable unicorn/no-await-expression-member -- The setup verifies the actual HTTP status before opening the browser.
import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { runAcceptance } from "./account-test-server";
import { origin } from "./http-fixture";
import { promptBrowser, promptOperation } from "./prompt-fixture";

test("retry and suspension status retain a visible open draft and recover without reload", async () => {
  const account = await promptBrowser();
  expect((await account.mutate([promptOperation()])).status).toBe(200);
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext();
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const separator = cookie.indexOf("=");
        return {
          name: cookie.slice(0, separator),
          value: cookie.slice(separator + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByText("Up to date at last check", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page
      .getByLabel("Content (required)")
      .fill("My retained unsaved text");
    let throttle = true;
    await page.route("**/api/v1/sync/changes?**", async (route) => {
      if (throttle) {
        throttle = false;
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          headers: { "Retry-After": "2" },
          body: JSON.stringify({
            code: "rate_limited",
            message: "Wait before retrying.",
            retryable: true,
            retryAfter: 2,
          }),
        });
      } else {
        await route.continue();
      }
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page
      .getByText("Service busy · Retrying in 2 seconds · Drafts retained", {
        exact: true,
      })
      .waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "My retained unsaved text"
    );
    await page.getByText("Up to date at last check", { exact: true }).waitFor();
    await runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/accounts.ts",
      "suspend",
      account.identity.accountId,
    ]);
    try {
      await page
        .getByText(
          "Account suspended · Drafts retained · Contact your instance operator",
          { exact: true }
        )
        .waitFor();
      expect(await page.getByLabel("Content (required)").inputValue()).toBe(
        "My retained unsaved text"
      );
      await page.getByLabel("Content (required)").focus();
      await page.keyboard.press("End");
      await page.keyboard.type(" still editable");
      expect(await page.getByLabel("Content (required)").inputValue()).toBe(
        "My retained unsaved text still editable"
      );
    } finally {
      await runAcceptance([
        "bun",
        "--conditions=react-server",
        "apps/web/scripts/accounts.ts",
        "resume",
        account.identity.accountId,
      ]);
    }
    await page.getByText("Up to date at last check", { exact: true }).waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "My retained unsaved text still editable"
    );
  } finally {
    await browser.close();
  }
});
