import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { origin } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
} from "./prompt-fixture";

test("keyboard lifecycle controls retain archived edits and retry a lost duplicate acknowledgement", async () => {
  const account = await promptBrowser();
  const create = promptOperation();
  await account.mutate([create]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 640, height: 900 },
    });
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    await page.goto(origin);
    const row = page.getByRole("button", {
      name: "Writing helper",
      exact: true,
    });
    await row.focus();
    await page.keyboard.press("Enter");
    const favorite = page.getByRole("button", {
      name: "Favorite Writing helper",
      exact: true,
    });
    await favorite.focus();
    await page.keyboard.press("Space");
    await page.getByText("Favorite updated.", { exact: true }).waitFor();
    const detail = page.getByRole("region", {
      name: "Writing helper",
      exact: true,
    });
    await detail
      .getByRole("button", { name: "Archive prompt", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page.getByText("Prompt archived.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Archive", exact: true }).focus();
    await page.keyboard.press("Enter");
    await row.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page.getByLabel("Content (required)").fill("Retained archive edit");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved to server.", { exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    const payloads: string[] = [];
    await page.route("**/api/v1/sync/mutations", async (route) => {
      payloads.push(route.request().postData() ?? "");
      const response = await route.fetch();
      await (payloads.length === 1
        ? route.abort("failed")
        : route.fulfill({ response }));
    });
    await detail
      .getByRole("button", { name: "Duplicate prompt", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Retry action", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page.getByText("Prompt duplicated.", { exact: true }).waitFor();
    expect(payloads[0]).toBe(payloads[1]);
    await page
      .getByRole("heading", { name: "Writing helper (copy)", exact: true })
      .waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "Retained archive edit"
    );
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await row.click();
    await detail
      .getByRole("button", { name: "Restore prompt", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page.getByText("Prompt restored.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await row.waitFor();
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: "docs/evidence/issue-31-lifecycle.png",
      fullPage: true,
    });
    const client = promptClient(account.Cookie);
    expect(await client.getPrompts()).toMatchObject({
      usage: { promptCount: 2 },
    });
    expect(await client.getPrompt(create.promptId)).toMatchObject({
      favorite: true,
      archived: false,
      content: "Retained archive edit",
    });
  } finally {
    await browser.close();
  }
}, 60_000);

test("multiple externally archived selections refresh stale rows without cycling", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const a = promptOperation({
    title: "External A",
    description: "",
    content: "A",
  });
  const b = promptOperation({
    title: "External B",
    description: "",
    content: "B",
  });
  await account.mutate([a, b]);
  const sources = await Promise.all([
    client.getPrompt(a.promptId),
    client.getPrompt(b.promptId),
  ]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "External B", exact: true })
      .waitFor();
    await page.waitForLoadState("networkidle");
    await account.mutate(
      sources.map((source) => promptState(source, "archived", true))
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange"))
    );
    await page
      .getByRole("heading", { name: "Your library is empty", exact: true })
      .waitFor();
    expect(await page.getByLabel("Saved content").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);

test("automatic selection follows identity across reordering and checks archive eligibility before the last page", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const first = promptOperation({
    title: "Selected A",
    description: "",
    content: "A",
  });
  const second = promptOperation({
    title: "Other B",
    description: "",
    content: "B",
  });
  await account.mutate([
    ...Array.from({ length: 50 }, () => promptOperation()),
    second,
    first,
  ]);
  const source = await client.getPrompt(first.promptId);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "Selected A", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Favorite Other B", exact: true })
      .click();
    await page.getByText("Favorite updated.", { exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    expect(
      await page
        .getByRole("heading", { name: "Selected A", exact: true })
        .count()
    ).toBe(1);
    await account.mutate([promptState(source, "archived", true)]);
    await page
      .getByRole("button", { name: "Unfavorite Other B", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Favorite Other B", exact: true })
      .waitFor();
    await page.waitForLoadState("networkidle");
    expect(
      await page
        .getByRole("heading", { name: "Selected A", exact: true })
        .count()
    ).toBe(0);
    expect(
      await page.getByRole("heading", { name: "Other B", exact: true }).count()
    ).toBe(1);
    expect(
      await page
        .getByRole("button", { name: "Load more prompts", exact: true })
        .count()
    ).toBe(1);
  } finally {
    await browser.close();
  }
}, 60_000);

test("quota errors keep the duplicate snapshot available while archive changes preserve an open editor", async () => {
  const account = await promptBrowser();
  await seedCapacity(account.identity, "promptCount");
  const create = promptOperation({
    title: "Capacity source",
    description: "",
    content: "Preserve this source",
  });
  await account.mutate([create]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Capacity source", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page
      .getByLabel("Content (required)")
      .fill("Keep my unsaved editor text");
    await page
      .getByRole("button", { name: "Archive prompt", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page.getByText("Prompt archived.", { exact: true }).waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "Keep my unsaved editor text"
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved to server.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page
      .getByRole("button", { name: "Capacity source", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Duplicate prompt", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByText(
        "Your library has reached 10,000 prompts. Archiving does not free capacity.",
        { exact: true }
      )
      .waitFor();
    expect(
      await page.getByLabel("Retained duplicate content").inputValue()
    ).toBe("Keep my unsaved editor text");
    await page
      .getByRole("button", { name: "Copy retained text", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page.getByText("Copied text.", { exact: true }).waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "Keep my unsaved editor text"
    );
    await page
      .getByRole("button", { name: "Retry action", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Dismiss action", exact: true })
      .waitFor();
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: "docs/evidence/issue-31-quota.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Dismiss action", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore prompt", exact: true })
      .click();
    await page.getByText("Prompt restored.", { exact: true }).waitFor();
  } finally {
    await browser.close();
  }
}, 60_000);
