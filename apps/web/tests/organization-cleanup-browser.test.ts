import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { openActionsMenu, openCollectionFilter } from "./app-menus";
import { collectionOperation, assignCollection } from "./collection-fixture";
import { origin } from "./http-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
} from "./prompt-fixture";
import { tagOperation } from "./tag-fixture";

test("manager requires explicit merge, preserves filters and focus, and confirms unused deletion", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const source = tagOperation("Draft");
  const target = tagOperation("Writing");
  const unused = tagOperation("Unused tag");
  const create = promptOperation();
  await account.mutate([
    source,
    target,
    unused,
    { ...create, desired: { ...create.desired, tagIds: [source.tagId] } },
  ]);
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
      .getByRole("group", { name: "Tag filters", exact: true })
      .getByRole("checkbox", { name: /Draft/u })
      .check();
    const opener = page.getByRole("button", {
      name: "Manage tags",
      exact: true,
    });
    await opener.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Rename Draft" }).click();
    await dialog.getByLabel("Tag name", { exact: true }).fill("writing");
    await dialog
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    const confirmation = dialog.getByRole("region", {
      name: "Confirm organization change",
    });
    await confirmation
      .getByRole("button", { name: "Merge into Writing", exact: true })
      .waitFor();
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    const unchanged = await client.getOrganization();
    expect(unchanged.tags).toHaveLength(3);
    expect(
      await dialog.getByLabel("Tag name", { exact: true }).inputValue()
    ).toBe("writing");
    await dialog
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await confirmation
      .getByRole("button", { name: "Merge into Writing", exact: true })
      .click();
    await dialog.getByText(/Tag “Draft” merged into “Writing”/u).waitFor();
    await dialog
      .getByRole("button", { name: "Review affected prompts" })
      .click();
    await dialog
      .getByRole("region", { name: "Active prompts", exact: true })
      .getByText(/Writing helper/u)
      .waitFor();
    await dialog.getByRole("button", { name: "Delete Unused tag" }).click();
    await confirmation
      .getByText("0 active prompts and 0 archived prompts.", { exact: true })
      .waitFor();
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    let attempts = 0;
    const operationIds: string[] = [];
    await page.route("**/api/v1/sync/mutations", async (route) => {
      const payload = route.request().postDataJSON();
      const [operation] = payload.operations;
      operationIds.push(operation.operationId);
      attempts += 1;
      if (attempts === 1) {
        await route.fetch();
        await route.abort("failed");
      } else if (attempts === 2) {
        await route.fulfill({
          json: {
            results: [
              {
                status: "rejected",
                error: {
                  code: "rate_limited",
                  message: "Retry shortly.",
                  retryable: true,
                  operationId: operation.operationId,
                },
              },
            ],
          },
        });
      } else {
        await route.continue();
      }
    });
    await dialog.getByRole("button", { name: "Delete Unused tag" }).click();
    await confirmation
      .getByRole("button", { name: "Delete tag", exact: true })
      .click();
    await dialog
      .getByText(
        "Saving is unconfirmed. Retry the original request before closing.",
        { exact: true }
      )
      .waitFor();
    await page.waitForResponse(
      (response) =>
        response.url().includes("organization/impact") &&
        response.status() === 404
    );
    await confirmation
      .getByRole("button", { name: "Retry original action" })
      .click();
    await dialog.getByText(/Retry shortly/u).waitFor();
    await confirmation
      .getByRole("button", { name: "Retry original action" })
      .click();
    await dialog.getByText(/Tag “Unused tag” deleted/u).waitFor();
    expect(attempts).toBe(3);
    expect(new Set(operationIds).size).toBe(1);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      await opener.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    const replacement = page.getByRole("button", {
      name: "Use Writing instead",
      exact: true,
    });
    await replacement.waitFor();
    const unavailable = await client.getPrompts({ tagIds: [source.tagId] });
    expect(unavailable.prompts).toEqual([]);
    await replacement.click();
    await page
      .getByRole("button", { name: "Remove tag Writing", exact: true })
      .waitFor();
  } finally {
    await browser.close();
  }
});

test("collection deletion reviews live assignments and keeps the deleted filter until explicitly cleared", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const work = collectionOperation("Work");
  const later = collectionOperation("Later");
  const creates = ["A", "B", "C", "D", "E"].map((title) => {
    const create = promptOperation();
    return {
      ...create,
      desired: { ...create.desired, title, collectionId: work.collectionId },
    };
  });
  await account.mutate([work, later, ...creates]);
  const saved = [];
  for (const create of creates) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Respect the per-library admission limit while preparing fixtures.
    saved.push(await client.getPrompt(create.promptId));
  }
  await account.mutate(
    saved.slice(3).map((prompt) => promptState(prompt, "archived", true))
  );
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
    await openCollectionFilter(page);
    await page
      .getByRole("group", { name: "Collection filter options" })
      .getByRole("button", { name: /^Work ·/u })
      .click();
    const opener = page.getByRole("button", {
      name: "Manage collections",
      exact: true,
    });
    await opener.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search collections", { exact: true }).fill("Work");
    await dialog
      .getByRole("button", { name: "Delete Work", exact: true })
      .click();
    const confirmation = dialog.getByRole("region", {
      name: "Confirm organization change",
    });
    await confirmation
      .getByText("3 active prompts and 2 archived prompts.", { exact: true })
      .waitFor();
    await confirmation
      .getByRole("button", { name: "Delete collection", exact: true })
      .click();
    await dialog.getByText(/Collection “Work” deleted/u).waitFor();
    await dialog
      .getByRole("button", { name: "Review affected prompts", exact: true })
      .click();
    await dialog
      .getByRole("region", { name: "Archived prompts", exact: true })
      .getByText(/D · Unassigned/u)
      .waitFor();
    const first = saved.at(0);
    if (!first) {
      throw new Error("Missing prompt fixture");
    }
    await account.mutate([assignCollection(first, later.collectionId)]);
    await dialog
      .getByRole("region", { name: "Active prompts", exact: true })
      .getByText(/A · Collection: Later/u)
      .waitFor();
    expect(
      await dialog
        .getByLabel("Search collections", { exact: true })
        .inputValue()
    ).toBe("Work");
    await dialog.screenshot({
      path: "docs/evidence/issue-35-collection-review.png",
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      await opener.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    const deletedFilter = page.getByRole("button", {
      name: "Remove collection Work · Deleted",
      exact: true,
    });
    await deletedFilter.waitFor();
    // Row duplication rests in a closed row menu, so match it while hidden.
    const duplicateA = page.getByRole("button", {
      name: "Duplicate A",
      exact: true,
      includeHidden: true,
    });
    expect(await duplicateA.count()).toBe(0);
    await page
      .getByRole("button", { name: "Go to All prompts", exact: true })
      .click();
    await deletedFilter.waitFor({ state: "hidden" });
    await duplicateA.waitFor({ state: "attached" });
    await openActionsMenu(page, "More actions for A");
    await duplicateA.waitFor();
  } finally {
    await browser.close();
  }
});

test("remote deletion clears actionable detail even when the selected filter has another result page", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const collection = collectionOperation("Remote collection");
  await account.mutate([collection]);
  const creates = Array.from({ length: 101 }, (_, index) => {
    const create = promptOperation();
    return {
      ...create,
      desired: {
        ...create.desired,
        title: `Remote ${index}`,
        collectionId: collection.collectionId,
      },
    };
  });
  await account.mutate(creates.slice(0, 100));
  await account.mutate(creates.slice(100));
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
    await page.goto(origin);
    await openCollectionFilter(page);
    await page
      .getByRole("group", { name: "Collection filter options" })
      .getByRole("button", { name: /^Remote collection ·/u })
      .click();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Load more prompts", exact: true })
      .waitFor();
    const snapshot = await client.getOrganization();
    const receipt = await client.mutatePrompts({
      ...account.identity,
      operations: [
        {
          kind: "collection.delete",
          operationId: crypto.randomUUID(),
          collectionId: collection.collectionId,
          baseRevision: snapshot.revision,
          dependsOn: [],
        },
      ],
    });
    expect(receipt.results).toMatchObject([
      { status: "accepted", effect: { activeCount: 101 } },
    ]);
    await page
      .getByRole("button", {
        name: "Remove collection Remote collection · Deleted",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .waitFor({ state: "hidden" });
    expect(
      await page
        .getByRole("button", { name: /^Duplicate /u, includeHidden: true })
        .count()
    ).toBe(0);
  } finally {
    await browser.close();
  }
});
