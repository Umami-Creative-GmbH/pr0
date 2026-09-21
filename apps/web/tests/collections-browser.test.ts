import { expect, test } from "bun:test";

import { chromium } from "playwright";

import {
  browseKeepingDraft,
  openCollectionFilter,
  resumeDraft,
} from "./app-menus";
import {
  collectionOperation,
  seedCollections,
  assignCollection,
} from "./collection-fixture";
import { origin } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
} from "./prompt-fixture";

const openLibrary = async (Cookie: string) => {
  const browser = await chromium.launch({
    channel: process.env.PR0_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  });
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

test.each([false, true])(
  "competing text and collection saves announce both outcomes (successor draft: %s)",
  async (successor) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const first = collectionOperation("First choice");
    const second = collectionOperation("Second choice");
    const create = promptOperation();
    await account.mutate([first, second, create]);
    const source = await client.getPrompt(create.promptId);
    const { browser, page } = await openLibrary(account.Cookie);
    let releaseResponse: (() => void) | undefined;
    // oxlint-disable-next-line promise/avoid-new -- Delay the real acceptance until a successor draft has been entered.
    const release = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    try {
      await page
        .getByRole("button", { name: "Edit prompt", exact: true })
        .click();
      await page.getByLabel("Content (required)").fill("My competing text");
      await page
        .getByRole("region", { name: "Edit prompt", exact: true })
        .getByRole("button", {
          name: "Second choice · 0 total, 0 active, 0 archived",
          exact: true,
        })
        .click();
      const competing = assignCollection(source, first.collectionId);
      competing.desired.content = "Another tab's competing text";
      competing.changedFields.push("content");
      await account.mutate([competing]);
      await page.route("**/api/v1/sync/mutations", async (route) => {
        const response = await route.fetch();
        await release;
        await route.fulfill({ response });
      });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Saving…", { exact: true }).waitFor();
      if (successor) {
        await page
          .getByLabel("Content (required)")
          .fill("My newer unsaved text");
      }
      releaseResponse?.();
      // The sync popover lists the adjustment by itself; assert the save status.
      const status = page.getByText(
        /saved to server\..*A concurrent collection assignment was superseded by this saved choice\./iu
      );
      await status.waitFor({ timeout: 5000 });
      expect(await status.textContent()).toContain("conflict copy");
      if (successor) {
        expect(await status.textContent()).toContain(
          "Your newer changes still need Save."
        );
        expect(await page.getByLabel("Content (required)").inputValue()).toBe(
          "My newer unsaved text"
        );
      }
    } finally {
      releaseResponse?.();
      await browser.close();
    }
  },
  60_000
);

test("all entries and Unused remain reachable at capacity; management retains filter, selection and keyboard focus", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await seedCapacity(account.identity, "promptCount");
  await seedCollections(account.identity, 200);
  const snapshot = await client.getOrganization();
  const last = snapshot.collections.at(-1);
  if (!last) {
    throw new Error("Missing final collection");
  }
  const create = promptOperation();
  await account.mutate([create]);
  const source = await client.getPrompt(create.promptId);
  await account.mutate([
    assignCollection(source, last.id),
    promptState(source, "archived", true),
  ]);
  const { browser, page } = await openLibrary(account.Cookie);
  try {
    const picker = page.getByRole("group", {
      name: "Collection filter options",
      exact: true,
    });
    // The collection filter rests inside the "Filter within this view" disclosure.
    await openCollectionFilter(page);
    await picker
      .getByRole("button", {
        name: "Collection 200 · 1 total, 0 active, 1 archived",
        exact: true,
      })
      .waitFor();
    expect(await picker.getByRole("button").count()).toBe(201);
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await openCollectionFilter(page);
    await page
      .getByLabel("Search collection filter", { exact: true })
      .fill("collection 200");
    await picker
      .getByRole("button", {
        name: "Collection 200 · 1 total, 0 active, 1 archived",
        exact: true,
      })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: "Writing helper", exact: true })
      .waitFor();
    const manage = page.getByRole("button", {
      name: "Manage collections",
      exact: true,
    });
    await manage.click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByText(
        "Your library is at or above 90% of its 200 collection limit.",
        { exact: true }
      )
      .waitFor();
    expect(
      await dialog.getByRole("button", { name: /^Rename /u }).count()
    ).toBe(200);
    await dialog.getByLabel("Unused", { exact: true }).check();
    expect(
      await dialog.getByRole("button", { name: /^Rename /u }).count()
    ).toBe(199);
    await dialog.getByLabel("Unused", { exact: true }).uncheck();
    await dialog.getByLabel("Search collections", { exact: true }).fill("200");
    await dialog
      .getByRole("button", { name: "Rename Collection 200", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await dialog
      .getByLabel("Collection name", { exact: true })
      .fill("ZZZ renamed");
    await dialog
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await dialog.getByText("Saved to server.", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      await manage.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    expect(
      await page
        .getByRole("button", { name: "Archive", exact: true })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      await page
        .getByLabel("Search collection filter", { exact: true })
        .inputValue()
    ).toBe("collection 200");
    await page
      .getByRole("button", {
        name: "Remove collection ZZZ renamed",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("heading", { name: "Writing helper", exact: true })
      .waitFor();
    await manage.click();
    await dialog
      .getByLabel("Collection name", { exact: true })
      .fill("Retained capacity draft");
    await dialog
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    await dialog
      .getByText(/Your library has reached 200 collections/u)
      .waitFor();
    expect(
      await dialog.getByLabel("Collection name", { exact: true }).inputValue()
    ).toBe("Retained capacity draft");
    await page.screenshot({
      path: "docs/evidence/issue-33-capacity.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}, 60_000);

test("lost acknowledgements replay unchanged; colliding rename retains its input and closing requires explicit discard", async () => {
  const account = await promptBrowser();
  await seedCollections(account.identity, 178);
  await account.mutate([collectionOperation("Other")]);
  const { browser, page } = await openLibrary(account.Cookie);
  try {
    await page
      .getByRole("button", { name: "Manage collections", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    expect(
      await dialog
        .getByText(
          "Your library is at or above 90% of its 200 collection limit.",
          { exact: true }
        )
        .count()
    ).toBe(0);
    const name = dialog.getByLabel("Collection name", { exact: true });
    await name.fill("Work");
    const payloads: string[] = [];
    await page.route("**/api/v1/sync/mutations", async (route) => {
      payloads.push(route.request().postData() ?? "");
      const response = await route.fetch();
      await (payloads.length === 1
        ? route.abort("failed")
        : route.fulfill({ response }));
    });
    await dialog
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Retry", exact: true }).waitFor();
    expect(await name.inputValue()).toBe("Work");
    expect(await name.getAttribute("readonly")).not.toBeNull();
    await dialog.getByRole("button", { name: "Retry", exact: true }).click();
    await dialog.getByText("Saved to server.", { exact: true }).waitFor();
    expect(payloads[0]).toBe(payloads[1]);
    await dialog
      .getByText(
        "Your library is at or above 90% of its 200 collection limit.",
        { exact: true }
      )
      .waitFor();
    await dialog
      .getByRole("button", { name: "Rename Work", exact: true })
      .click();
    await name.fill("OTHER");
    await dialog
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await dialog
      .getByText("A collection with an equivalent name already exists.", {
        exact: true,
      })
      .waitFor();
    expect(await name.inputValue()).toBe("OTHER");
    await page.keyboard.press("Escape");
    await dialog
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    expect(await name.inputValue()).toBe("OTHER");
    await name.fill("Ready");
    await dialog
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await dialog.getByText("Saved to server.", { exact: true }).waitFor();
    const result = await promptClient(account.Cookie).getOrganization();
    expect(result.collections).toHaveLength(180);
    expect(result.collections.slice(-2).map((entry) => entry.name)).toEqual([
      "Other",
      "Ready",
    ]);
  } finally {
    await browser.close();
  }
}, 60_000);

test("keyboard collection management creates, assigns, renames and restores focus without losing the prompt draft", async () => {
  const account = await promptBrowser();
  const prompt = promptOperation();
  await account.mutate([prompt]);
  const { browser, page } = await openLibrary(account.Cookie);
  try {
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page.getByLabel("Content (required)").fill("My underlying draft");
    // The editor is modal; keep the draft mounted while managing collections.
    await browseKeepingDraft(page);
    const manage = page.getByRole("button", {
      name: "Manage collections",
      exact: true,
    });
    await manage.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Manage collections and tags",
    });
    await dialog.getByLabel("Collection name", { exact: true }).fill("Work");
    await dialog
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    await dialog.getByText("Saved to server.", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      await manage.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "My underlying draft"
    );
    await resumeDraft(page);
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "My underlying draft"
    );
    const editor = page.getByRole("region", {
      name: "Edit prompt",
      exact: true,
    });
    await editor
      .getByRole("button", {
        name: "Work · 0 total, 0 active, 0 archived",
        exact: true,
      })
      .click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved to server.", { exact: true }).waitFor();
    const before = await promptClient(account.Cookie).getPrompt(
      prompt.promptId
    );
    await manage.click();
    await dialog
      .getByRole("button", { name: "Rename Work", exact: true })
      .click();
    await dialog.getByLabel("Collection name", { exact: true }).fill("WORK");
    await dialog
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await dialog.getByText("Saved to server.", { exact: true }).waitFor();
    await page.screenshot({
      path: "docs/evidence/issue-33-collections.png",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      await promptClient(account.Cookie).getPrompt(prompt.promptId)
    ).toMatchObject({
      modifiedAt: before.modifiedAt,
      collectionId: before.collectionId,
    });
    await page.getByText("Collection: WORK", { exact: true }).waitFor();
  } finally {
    await browser.close();
  }
}, 60_000);
