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

test("conflict review retries a failed acknowledgement and keeps both without losing keyboard focus", async () => {
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
    const attempts: string[] = [];
    await page.route("**/api/v1/sync/mutations", async (route) => {
      attempts.push(route.request().postData() ?? "");
      await (attempts.length === 1 ? route.abort("failed") : route.continue());
    });
    await page.getByRole("button", { name: "Keep both", exact: true }).click();
    await page
      .getByText(
        "Could not confirm review. Your prompts were kept. Retry the review when connected.",
        { exact: true }
      )
      .waitFor();
    expect(
      await page
        .getByRole("button", { name: "Keep both", exact: true })
        .isEnabled()
    ).toBe(true);
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
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(attempts[0]);
  } finally {
    await browser.close();
  }
});
