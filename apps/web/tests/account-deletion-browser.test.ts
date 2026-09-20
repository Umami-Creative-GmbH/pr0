import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { freshSocialBrowser } from "./email-change-fixture";
import { origin } from "./http-fixture";

test("keyboard confirmation can be cancelled and completion clears the browser library", async () => {
  const account = await freshSocialBrowser();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 640, height: 900 },
    });
    context.setDefaultTimeout(6000);
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
    await page.waitForLoadState("networkidle");
    const opener = page.getByRole("button", {
      name: "Delete account",
      exact: true,
    });
    await opener.press("Enter");
    const confirmation = page.getByRole("region", {
      name: "Confirm account deletion",
    });
    try {
      await confirmation.waitFor();
    } catch {
      throw new Error(
        `Deletion screen status: ${await page.getByRole("region", { name: "Delete account", exact: true }).textContent()}`
      );
    }
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .press("Enter");
    expect(
      await opener.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    await opener.press("Enter");
    await confirmation
      .getByLabel(
        "I understand that my account and entire library will be permanently deleted"
      )
      .check();
    await confirmation
      .getByRole("button", { name: "Permanently delete account and library" })
      .press("Enter");
    await page
      .getByText(
        "Your account and library have been deleted. The signed receipt has been verified.",
        { exact: true }
      )
      .waitFor();
    expect(
      await page
        .getByRole("heading", { name: "Your library", exact: true })
        .count()
    ).toBe(0);
    expect(
      await page
        .getByRole("button", { name: "Download deletion receipt" })
        .count()
    ).toBe(1);
  } finally {
    await browser.close();
  }
});
