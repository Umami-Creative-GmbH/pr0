import { expect, test } from "bun:test";

import { chromium } from "playwright";

import {
  browseKeepingDraft,
  openActionsMenu,
  resumeDraft,
  trackNetwork,
} from "./app-menus";
import { origin } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptEdit,
  promptDeletion,
} from "./prompt-fixture";

test("keyboard cancellation and confirmation work in active and archived views; a lost acknowledgement is retried exactly", async () => {
  const account = await promptBrowser();
  const create = promptOperation();
  await account.mutate([create]);
  const browser = await chromium.launch({
    channel: process.env.PR0_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  });
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
    page.setDefaultTimeout(10_000);
    await page.goto(origin);
    const trigger = page.getByRole("button", {
      name: "Permanently delete prompt",
      exact: true,
    });
    // Deletion rests inside the detail's "More prompt actions" menu.
    const menu = page.getByLabel("More prompt actions", { exact: true });
    await menu.focus();
    await page.keyboard.press("Enter");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Permanently delete prompt?",
    });
    await dialog.waitFor();
    expect(
      await dialog
        .getByRole("button", { name: "Cancel", exact: true })
        .evaluate((element) => element === document.activeElement)
    ).toBe(true);
    await page.keyboard.press("Escape");
    expect(
      await trigger.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    expect(
      await promptClient(account.Cookie).getPrompt(create.promptId)
    ).toMatchObject(create.desired);
    await openActionsMenu(page, "More prompt actions");
    await trigger.click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await openActionsMenu(page, "More prompt actions");
    await page
      .getByRole("button", { name: "Archive prompt", exact: true })
      .click();
    await page.getByText("Prompt archived.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await openActionsMenu(page, "More prompt actions");
    await trigger.click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const payloads: string[] = [];
    await page.route("**/api/v1/sync/mutations", async (route) => {
      payloads.push(route.request().postData() ?? "");
      const response = await route.fetch();
      await (payloads.length === 1
        ? route.abort("failed")
        : route.fulfill({ response }));
    });
    await openActionsMenu(page, "More prompt actions");
    await trigger.click();
    await page.screenshot({
      path: "docs/evidence/issue-32-confirmation.png",
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Permanently delete", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Retry action", exact: true })
      .click();
    await page
      .getByText("Prompt permanently deleted.", { exact: true })
      .waitFor();
    expect(payloads[0]).toBe(payloads[1]);
    await page
      .getByText("No prompts in the archive.", { exact: true })
      .waitFor();
    await expect(
      promptClient(account.Cookie).getPrompt(create.promptId)
    ).rejects.toMatchObject({ status: 404 });
  } finally {
    await browser.close();
  }
}, 60_000);

test("active-list deletion preserves an unseen edit and leaves an open draft recoverable as a second copy", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const base = await client.getPrompt(create.promptId);
  const browser = await chromium.launch({
    channel: process.env.PR0_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  });
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
    page.setDefaultTimeout(10_000);
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page.getByLabel("Content (required)").fill("My open draft");
    // The editor is modal; keep the draft mounted while using the row menu.
    await browseKeepingDraft(page);
    await openActionsMenu(page, "More actions for Writing helper");
    await page
      .getByRole("button", {
        name: "Permanently delete Writing helper",
        exact: true,
      })
      .click();
    await account.mutate([
      promptEdit(base, { ...create.desired, description: "Unseen edit" }),
    ]);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Permanently delete", exact: true })
      .click();
    await page
      .getByText(
        "Prompt permanently deleted. Unseen text was preserved in a conflict copy.",
        { exact: true }
      )
      .waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "My open draft"
    );
    await resumeDraft(page);
    const held = Promise.withResolvers<undefined>();
    await page.route("**/api/v1/sync/mutations", async (route) => {
      const response = await route.fetch();
      await held.promise;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saving…", { exact: true }).waitFor();
    await page.getByLabel("Content (required)").fill("My newer draft");
    held.resolve();
    const editor = page.getByRole("region", {
      name: "Edit prompt",
      exact: true,
    });
    await editor
      .getByText("You're editing the conflict copy.", { exact: true })
      .waitFor();
    await editor
      .getByText("Original is no longer available.", { exact: true })
      .waitFor();
    expect(
      await editor
        .getByRole("button", { name: "Open original", exact: true })
        .count()
    ).toBe(0);
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "My newer draft"
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved to server.", { exact: true }).waitFor();
    await page.getByText("Conflicts to review", { exact: true }).click();
    await page
      .getByText("Original permanently deleted.", { exact: true })
      .first()
      .waitFor();
    expect(
      await page
        .getByRole("button", { name: "Open original", exact: true })
        .count()
    ).toBe(0);
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "My newer draft"
    );
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page
      .getByText("No prompts in the archive.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Open conflict copy", exact: true })
      .first()
      .click();
    await page.getByLabel("Saved content").waitFor({ timeout: 10_000 });
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "My newer draft"
    );
    const preserved = await client.getPrompts();
    expect(preserved.usage.promptCount).toBe(2);
    await page.screenshot({
      path: "docs/evidence/issue-32-preservation.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}, 60_000);

test("capacity-refused deletion retains the frozen intent for retry after freeing space", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await seedCapacity(account.identity, "textBytes");
  const pageBefore = await client.getPrompts();
  const [first, second] = pageBefore.prompts;
  if (!first || !second) {
    throw new Error("Expected capacity prompts");
  }
  const base = await client.getPrompt(first.id);
  const browser = await chromium.launch({
    channel: process.env.PR0_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  });
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
    const network = trackNetwork(page);
    page.setDefaultTimeout(10_000);
    await page.goto(origin);
    await openActionsMenu(page, "More prompt actions");
    await page
      .getByRole("button", { name: "Permanently delete prompt", exact: true })
      .click();
    await account.mutate([
      promptEdit(base, {
        title: base.title,
        description: base.description,
        content: `${base.content.slice(0, -1)}y`,
      }),
    ]);
    const payloads: string[] = [];
    await page.route("**/api/v1/sync/mutations", async (route) => {
      payloads.push(route.request().postData() ?? "");
      await route.continue();
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Permanently delete", exact: true })
      .click();
    // The attention link repeats this text; assert the recovery alert itself.
    await page
      .getByRole("alert")
      .getByText(
        "Unseen text needs a conflict copy, but your library has reached capacity. Nothing was changed. Keep this tab open, free capacity, and retry; your pending action or draft is retained.",
        { exact: true }
      )
      .waitFor();
    expect(await client.getPrompt(base.id)).toMatchObject({
      content: `${base.content.slice(0, -1)}y`,
    });
    await page.screenshot({
      path: "docs/evidence/issue-32-capacity.png",
      fullPage: true,
    });
    await account.mutate([promptDeletion(second)]);
    await page
      .getByRole("button", { name: "Retry action", exact: true })
      .click();
    await page
      .getByText(
        "Prompt permanently deleted. Unseen text was preserved in a conflict copy.",
        { exact: true }
      )
      .waitFor();
    expect(payloads[0]).toBe(payloads[1]);
    await network.idle();
    await expect(client.getPrompt(base.id)).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    await browser.close();
  }
}, 60_000);
