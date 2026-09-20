import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { origin } from "./http-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
} from "./prompt-fixture";
import { seedTags, tagOperation } from "./tag-fixture";

const openLibrary = async (Cookie: string) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 640, height: 900 },
  });
  await context.addCookies(
    Cookie.split("; ").map((cookie) => {
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
  return { browser, page };
};

test("keyboard management creates unused tags, reports equivalents, renames and assigns without leaving the library", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const { browser, page } = await openLibrary(account.Cookie);
  try {
    const opener = page.getByRole("button", {
      name: "Manage tags",
      exact: true,
    });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Manage collections and tags",
    });
    await dialog.getByLabel("Tag name", { exact: true }).fill("Straße");
    expect(
      await dialog
        .getByRole("button", { name: "Create tag", exact: true })
        .isEnabled()
    ).toBe(true);
    expect(
      await dialog
        .getByLabel("Tag name", { exact: true })
        .evaluate((element) => document.activeElement === element)
    ).toBe(true);
    await page.keyboard.press("Enter");
    await dialog.getByText("Saved to server.", { exact: true }).waitFor();
    await dialog.getByLabel("Tag name", { exact: true }).fill("STRASSE");
    await page.keyboard.press("Enter");
    await dialog
      .getByText("Tag “Straße” already exists. No prompts were assigned.", {
        exact: true,
      })
      .waitFor();
    const equivalentSnapshot = await client.getOrganization();
    expect(equivalentSnapshot.tags).toHaveLength(1);
    await dialog.getByRole("button", { name: "Rename Straße" }).focus();
    await page.keyboard.press("Enter");
    await dialog.getByLabel("Tag name", { exact: true }).fill("Ready");
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Rename Ready" }).waitFor();
    await page.keyboard.press("Escape");
    expect(
      await opener.evaluate((element) => document.activeElement === element)
    ).toBe(true);
    await page
      .getByRole("button", { name: "Edit tags", exact: true })
      .press("Enter");
    const assignments = page.getByRole("group", { name: "Prompt tags" });
    await assignments.getByRole("checkbox", { name: /Ready/u }).focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Save tags", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByText("Tags saved to server.", { exact: true }).waitFor();
    const assignedSnapshot = await client.getOrganization();
    const [tag] = assignedSnapshot.tags;
    expect(await client.getPrompt(create.promptId)).toMatchObject({
      tagIds: [tag?.id],
    });
    await assignments.getByRole("checkbox", { name: /Ready/u }).focus();
    await page.keyboard.press("Space");
    await page
      .getByRole("button", { name: "Save tags", exact: true })
      .press("Enter");
    await page.getByText("Tags saved to server.", { exact: true }).waitFor();
    await opener.press("Enter");
    await dialog.getByRole("checkbox", { name: "Unused", exact: true }).check();
    await dialog.getByRole("button", { name: "Rename Ready" }).waitFor();
    const unusedSnapshot = await client.getOrganization();
    expect(unusedSnapshot.tags[0]).toMatchObject({
      totalCount: 0,
    });
    await dialog.screenshot({
      path: "docs/evidence/issue-34-tags.png",
    });
  } finally {
    await browser.close();
  }
});

test("all 1,000 tags remain searchable with archived counts, unused filtering and capacity feedback", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await seedTags(account.identity, 1000);
  const snapshot = await client.getOrganization();
  const [first] = snapshot.tags;
  if (!first) {
    throw new Error("Missing tag fixture");
  }
  const create = promptOperation();
  create.desired = { ...create.desired, tagIds: [first.id] };
  await account.mutate([create]);
  const prompt = await client.getPrompt(create.promptId);
  await account.mutate([promptState(prompt, "archived", true)]);
  const { browser, page } = await openLibrary(account.Cookie);
  try {
    const filters = page.getByRole("group", {
      name: "Tag filters",
      exact: true,
    });
    await filters.getByRole("checkbox", { name: /Tag 1000/u }).waitFor();
    expect(await filters.getByRole("checkbox").count()).toBe(1000);
    await filters.getByLabel("Search tag filters").fill("1000");
    expect(await filters.getByRole("checkbox").count()).toBe(1);
    await filters.getByRole("checkbox", { name: /Tag 1000/u }).check();
    await page
      .getByRole("button", { name: "Manage tags", exact: true })
      .press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Manage collections and tags",
    });
    await dialog.getByText(/90%.*1,000 tag limit/u).waitFor();
    await dialog.getByLabel("Search tags", { exact: true }).fill("0001");
    await dialog
      .getByText("1 total · 0 active · 1 archived", { exact: true })
      .waitFor();
    await dialog.getByRole("checkbox", { name: "Unused", exact: true }).check();
    await dialog.getByText("No matching tags.", { exact: true }).waitFor();
    await dialog.getByLabel("Search tags", { exact: true }).fill("1000");
    await dialog
      .getByRole("button", { name: "Rename Tag 1000", exact: true })
      .waitFor();
    await dialog
      .getByLabel("Tag name", { exact: true })
      .fill("Name retained at capacity");
    await page.keyboard.press("Enter");
    await dialog.getByText(/Your library has reached 1,000 tags/u).waitFor();
    expect(
      await dialog.getByLabel("Tag name", { exact: true }).inputValue()
    ).toBe("Name retained at capacity");
    await dialog.screenshot({
      path: "docs/evidence/issue-34-capacity.png",
    });
    await page.keyboard.press("Escape");
    await dialog
      .getByRole("button", { name: "Keep editing", exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: "Discard name", exact: true })
      .press("Enter");
    expect(
      await filters
        .getByRole("button", { name: "Remove tag Tag 1000", exact: true })
        .isVisible()
    ).toBe(true);
  } finally {
    await browser.close();
  }
});

test("saving a retained editor after selecting another prompt blocks duplication until its saved snapshot refreshes", async () => {
  const account = await promptBrowser();
  const first = promptOperation({
    title: "First prompt",
    description: "",
    content: "Before edit",
  });
  const second = promptOperation({
    title: "Second prompt",
    description: "",
    content: "Other prompt",
  });
  await account.mutate([first, second]);
  const { browser, page } = await openLibrary(account.Cookie);
  const paused = Promise.withResolvers<undefined>();
  try {
    await page
      .getByRole("button", { name: "First prompt", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page
      .getByLabel("Content (required)")
      .fill("Saved from retained editor");
    await page
      .getByRole("button", { name: "Second prompt", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Second prompt", exact: true })
      .waitFor();
    await page.route(
      `**/api/v1/library/prompts/${first.promptId}`,
      async (route) => {
        await paused.promise;
        await route.continue();
      }
    );
    const refreshing = page.waitForRequest((request) =>
      request.url().endsWith(`/api/v1/library/prompts/${first.promptId}`)
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await refreshing;
    await page.getByText("Saved to server.", { exact: true }).waitFor();
    const duplicate = page.getByRole("button", {
      name: "Duplicate prompt",
      exact: true,
    });
    expect(await duplicate.isDisabled()).toBe(true);
    paused.resolve();
    await duplicate.click();
    await page
      .getByRole("heading", { name: "First prompt (copy)", exact: true })
      .waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "Saved from retained editor"
    );
  } finally {
    paused.resolve();
    await browser.close();
  }
});

test("a lost tag-save response retains the draft and retries the same operation without duplicate effects", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await account.mutate([tagOperation("Writing")]);
  const { browser, page } = await openLibrary(account.Cookie);
  try {
    await page
      .getByRole("button", { name: "Manage tags", exact: true })
      .press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Manage collections and tags",
    });
    await dialog.getByLabel("Tag name", { exact: true }).fill("New tag");
    await page.route(
      "**/api/v1/sync/mutations",
      async (route) => {
        await route.fetch();
        await route.abort();
      },
      { times: 1 }
    );
    await page.keyboard.press("Enter");
    await dialog.getByText(/The server did not confirm saving/u).waitFor();
    expect(
      await dialog.getByLabel("Tag name", { exact: true }).inputValue()
    ).toBe("New tag");
    const accepted = await client.getOrganization();
    expect(accepted.tags).toHaveLength(2);
    await dialog
      .getByRole("button", { name: "Retry", exact: true })
      .press("Enter");
    await dialog.getByText("Saved to server.", { exact: true }).waitFor();
    expect(await client.getOrganization()).toEqual(accepted);
    await dialog
      .getByRole("button", { name: "Rename New tag", exact: true })
      .press("Enter");
    await dialog.getByLabel("Tag name", { exact: true }).fill("writing");
    await page.keyboard.press("Enter");
    await dialog
      .getByText(
        "This rename requires an explicit merge. Choose another name.",
        { exact: true }
      )
      .waitFor();
    expect(
      await dialog.getByLabel("Tag name", { exact: true }).inputValue()
    ).toBe("writing");
    expect(
      await dialog.getByRole("button", { name: /Merge into/u }).count()
    ).toBe(0);
    expect(await client.getOrganization()).toEqual(accepted);
  } finally {
    await browser.close();
  }
});
