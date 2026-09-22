import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { collectionOperation, seedCollections } from "./collection-fixture";
import { origin } from "./http-fixture";
import { promptBrowser, promptOperation, promptClient } from "./prompt-fixture";
import { tagOperation, seedTags } from "./tag-fixture";

test("collection navigation resets extras, restores per-view sorts and retains five-field selection", async () => {
  const account = await promptBrowser();
  const work = collectionOperation("Work");
  const tag = tagOperation("German");
  const create = promptOperation({
    title: "Email reply",
    description: "",
    content: "body",
  });
  await account.mutate([
    work,
    tag,
    {
      ...create,
      desired: {
        ...create.desired,
        collectionId: work.collectionId,
        tagIds: [tag.tagId],
      },
    },
  ]);
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
    page.setDefaultTimeout(5000);
    await page.goto(origin);
    const search = page.getByRole("searchbox", { name: "Search prompts" });
    await page.getByLabel("Sort prompts").selectOption("title");
    await search.fill("German email");
    await page.getByLabel("Saved content").waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe("body");
    await page.screenshot({
      path: "docs/evidence/issue-37-search.png",
      fullPage: true,
    });
    await page
      .getByRole("checkbox", { name: "Favorites only", exact: true })
      .check();
    await page.getByText("No matching prompts", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Clear extra filters", exact: true })
      .click();
    expect(await search.inputValue()).toBe("German email");
    await page.getByLabel("Saved content").waitFor();
    await page
      .getByRole("group", { name: "Collection view options", exact: true })
      .getByRole("button", { name: /^Work/u })
      .click();
    expect(await search.inputValue()).toBe("");
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe(
      "recently-modified"
    );
    await page.getByLabel("Sort prompts").selectOption("oldest");
    await search.fill("Work");
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe(
      "relevance"
    );
    await page.getByLabel("Sort prompts").selectOption("newest");
    await search.fill("Work email");
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("newest");
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("oldest");
    await page.getByRole("checkbox", { name: /^German ·/u }).check();
    await page
      .getByRole("button", { name: "Clear extra filters", exact: true })
      .click();
    expect(
      await page
        .getByRole("group", { name: "Collection view options", exact: true })
        .getByRole("button", { name: /^Work/u })
        .getAttribute("aria-pressed")
    ).toBe("true");
    await page
      .getByRole("navigation", { name: "Prompt views" })
      .getByRole("button", { name: "All prompts", exact: true })
      .click();
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("title");
    await page.reload();
    await page.getByLabel("Sort prompts").waitFor();
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("title");
    expect(await search.inputValue()).toBe("");
  } finally {
    await browser.close();
  }
});

test("complete pickers reach capacity entries and a deleted collection view stays unavailable", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await seedCollections(account.identity, 200);
  await seedTags(account.identity, 1000);
  const organization = await client.getOrganization();
  const collection = organization.collections.find(
    (entry) => entry.name === "Collection 200"
  );
  if (!collection) {
    throw new Error("Missing capacity collection");
  }
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
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "Your library is empty" })
      .waitFor();
    await page
      .getByLabel("Search collection view", { exact: true })
      .fill("200");
    await page
      .getByRole("group", { name: "Collection view options", exact: true })
      .getByRole("button", { name: /^Collection 200/u })
      .press("Enter");
    await page
      .getByText(
        "This collection is empty. Create a prompt or choose another view.",
        { exact: true }
      )
      .waitFor();
    await page.getByLabel("Search tag filters", { exact: true }).fill("1000");
    const tag = page.getByRole("checkbox", { name: /^Tag 1000/u });
    await tag.press("Space");
    await page.getByText("No matching prompts", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Remove tag Tag 1000", exact: true })
      .press("Enter");
    await page
      .getByText(
        "This collection is empty. Create a prompt or choose another view.",
        { exact: true }
      )
      .waitFor();
    const current = await client.getOrganization();
    await account.mutate([
      {
        kind: "collection.delete",
        operationId: crypto.randomUUID(),
        collectionId: collection.id,
        baseRevision: current.revision,
        dependsOn: [],
      },
    ]);
    await account.mutate([collectionOperation("Collection 200")]);
    await page
      .getByText("This collection was deleted and is unavailable.", {
        exact: false,
      })
      .waitFor({ timeout: 25_000 });
    expect(
      await page
        .getByRole("button", {
          name: "Remove collection Collection 200 · Deleted",
          exact: true,
        })
        .count()
    ).toBe(1);
    await page
      .getByRole("button", { name: "Go to All prompts", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your library is empty" })
      .waitFor();
  } finally {
    await browser.close();
  }
});
