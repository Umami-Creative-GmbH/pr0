import { expect, test } from "bun:test";

import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";

import { freshSocialBrowser } from "./email-change-fixture";
import { origin } from "./http-fixture";

const setAccount = (context: BrowserContext, Cookie: string) =>
  context.addCookies(
    Cookie.split("; ").map((cookie) => {
      const separator = cookie.indexOf("=");
      return {
        name: cookie.slice(0, separator),
        value: cookie.slice(separator + 1),
        url: origin,
      };
    })
  );
const confirmDeletion = async (page: Page) => {
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await page
    .getByLabel(
      "I understand that my account and entire library will be permanently deleted"
    )
    .check();
  await page
    .getByRole("button", { name: "Permanently delete account and library" })
    .click();
};

test("reload recovers the pinned deletion receipt without a surviving session", async () => {
  const account = await freshSocialBrowser();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(6000);
    await setAccount(context, account.Cookie);
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForLoadState("networkidle");
    const interrupted = Promise.withResolvers<undefined>();
    await page.route(
      "**/api/v1/account-deletions/verification",
      async (route) => {
        await route.abort();
        interrupted.resolve();
      }
    );
    await confirmDeletion(page);
    await interrupted.promise;
    await page.getByRole("button", { name: "Check deletion status" }).waitFor();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Check deletion status" }).waitFor();
    expect(
      await page
        .getByRole("heading", { name: "Your library", exact: true })
        .count()
    ).toBe(0);
    await page.unroute("**/api/v1/account-deletions/verification");
    await page.getByRole("button", { name: "Check deletion status" }).click();
    await page
      .getByRole("button", { name: "Download deletion receipt" })
      .waitFor();
  } finally {
    await browser.close();
  }
});

test("a delayed old receipt cannot clear another account's unsaved draft", async () => {
  const account = await freshSocialBrowser();
  const nextAccount = await freshSocialBrowser();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const gate = Promise.withResolvers<undefined>();
  const requested = Promise.withResolvers<undefined>();
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(8000);
    await setAccount(context, account.Cookie);
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForLoadState("networkidle");
    await page.route(
      "**/api/v1/account-deletions/verification",
      async (route) => {
        const response = await route.fetch();
        requested.resolve();
        await gate.promise;
        await route.fulfill({ response });
      }
    );
    await confirmDeletion(page);
    await requested.promise;
    await context.clearCookies();
    await setAccount(context, nextAccount.Cookie);
    const refreshed = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/library")
    );
    await page.evaluate(() => {
      // Exercise the browser's background/foreground session refresh without reloading React.
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      window.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      window.dispatchEvent(new Event("visibilitychange"));
    });
    const response = await refreshed;
    expect(await response.json()).toMatchObject({
      account: { id: nextAccount.identity.accountId },
    });
    try {
      await page.getByText(nextAccount.email, { exact: true }).waitFor();
    } catch {
      throw new Error(
        `Switch status: ${await page.locator("main").textContent()}`
      );
    }
    await page
      .getByRole("button", { name: "Create prompt", exact: true })
      .click();
    await page.getByLabel("Title (required)").fill("Keep this draft");
    await page
      .getByLabel("Content (required)")
      .fill("Another account's unsaved work");
    gate.resolve();
    await page
      .getByRole("button", { name: "Download deletion receipt" })
      .waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "Another account's unsaved work"
    );
    await page
      .getByText("Unsaved changes in this tab.", { exact: true })
      .waitFor();
    expect(
      await page.getByText(nextAccount.email, { exact: true }).count()
    ).toBe(1);
  } finally {
    gate.resolve();
    await browser.close();
  }
});

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
