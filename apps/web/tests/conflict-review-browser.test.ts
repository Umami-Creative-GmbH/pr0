import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { origin } from "./http-fixture";
import {
  promptBrowser,
  promptClient,
  promptEdit,
  promptOperation,
} from "./prompt-fixture";

test("failed web save keeps the draft and prevents an all-clear status", async () => {
  const account = await promptBrowser();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => ({
        name: cookie.slice(0, cookie.indexOf("=")),
        value: cookie.slice(cookie.indexOf("=") + 1),
        url: origin,
      }))
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Create prompt", exact: true })
      .click();
    await page.getByLabel("Title (required)").fill("Retained draft");
    await page.getByLabel("Content (required)").fill("  Exact draft\n");
    await page.route("**/api/v1/sync/mutations", (route) =>
      route.abort("failed")
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText(/^Not saved\./u).waitFor();
    await page
      .getByText("Changes need attention · Unsaved work in this tab", {
        exact: true,
      })
      .waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "  Exact draft\n"
    );
  } finally {
    await browser.close();
  }
});

test("conflict review labels archived originals and keeps both without losing keyboard focus", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await client.mutatePrompts({ ...account.identity, operations: [create] });
  const base = await client.getPrompt(create.promptId);
  await client.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, { ...create.desired, content: "first" })],
  });
  await client.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, { ...create.desired, content: "second" })],
  });
  const current = await client.getPrompt(base.id);
  const text = {
    title: current.title,
    description: current.description,
    content: current.content,
  };
  await client.mutatePrompts({
    ...account.identity,
    operations: [
      {
        ...promptEdit(current, text),
        changedFields: ["archived"],
        base: { ...text, archived: false },
        desired: { ...text, archived: true },
      },
    ],
  });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => ({
        name: cookie.slice(0, cookie.indexOf("=")),
        value: cookie.slice(cookie.indexOf("=") + 1),
        url: origin,
      }))
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByText("Conflicts to review", { exact: true }).click();
    await page.getByText("Original archived.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Keep both", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page
      .getByText("Review recorded. Both prompts and retained titles were kept.")
      .waitFor();
    expect(await page.locator("summary:focus").textContent()).toContain(
      "Conflicts to review"
    );
    const reviewed = await client.getConflicts();
    expect(reviewed.notices).toEqual([]);
  } finally {
    await browser.close();
  }
});
