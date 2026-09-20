import { expect, test } from "bun:test";

import { promptUseFixtures } from "@pr0/api-contract/prompt-use-fixtures";

import { copyBrowser, waitForCopy } from "./copy-browser-fixture";
import { origin } from "./http-fixture";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";
import { withUsageStorageFailure } from "./prompt-storage-fixture";

test("clipboard initiation retains the original gesture while eligibility is prepared asynchronously", async () => {
  const account = await promptBrowser();
  const create = promptOperation();
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page.getByLabel("Saved content").waitFor();
    await page.evaluate(() => {
      window.clipboardTest.requireGesture = true;
    });
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await waitForCopy(page);
  } finally {
    await ui.browser.close();
  }
});

test("copy failures record no use; list and detail copy exact saved text without navigation", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation({
    title: "Exact copy",
    description: "",
    content: promptUseFixtures.text,
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page.getByLabel("Saved content").waitFor();
    await page.evaluate(() => {
      window.clipboardTest.fail = true;
    });
    await page
      .getByRole("button", { name: "Copy Exact copy", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry copy", exact: true })
      .waitFor();
    const failed = await client.getPrompt(create.promptId);
    expect(failed.useCount).toBe(0);
    await page.evaluate(() => {
      window.clipboardTest.fail = false;
    });
    await page.getByRole("button", { name: "Retry copy", exact: true }).click();
    await waitForCopy(page);
    expect(await page.evaluate(() => window.clipboardTest.writes.at(-1))).toBe(
      create.desired.content
    );
    const pasted = await page.evaluate(() => navigator.clipboard.readText());
    expect(pasted.replaceAll("\r\n", "\n")).toBe(create.desired.content);
    expect(page.url()).toBe(`${origin}/`);
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await waitForCopy(page);
    const copied = await client.getPrompt(create.promptId);
    expect(copied.useCount).toBe(2);
    await page.getByRole("button", { name: "Recents", exact: true }).click();
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe(
      "recently-used"
    );
    await page.getByLabel("Saved content").waitFor();
    await page.getByRole("searchbox", { name: "Search prompts" }).fill("world");
    await page
      .getByRole("button", { name: "Copy Exact copy", exact: true })
      .waitFor();
    await page.screenshot({
      path: "docs/evidence/issue-38-recents.png",
      fullPage: true,
    });
  } finally {
    await ui.browser.close();
  }
});

test("usage transport failures and lost acknowledgements retry only the same usage operation", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page.getByLabel("Saved content").waitFor();
    await page.route("**/api/v1/sync/mutations", (route) => route.abort());
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .waitFor();
    const before = await client.getPrompt(create.promptId);
    expect(before.useCount).toBe(0);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "Hello",
    ]);
    await page.unroute("**/api/v1/sync/mutations");
    await page.route("**/api/v1/sync/mutations", async (route) => {
      await route.fetch();
      await route.abort();
    });
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        !document
          .querySelector<HTMLButtonElement>("button:disabled")
          ?.textContent?.includes("Retry usage")
    );
    await page.unroute("**/api/v1/sync/mutations");
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .click();
    await waitForCopy(page);
    const after = await client.getPrompt(create.promptId);
    expect(after.useCount).toBe(1);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "Hello",
    ]);
  } finally {
    await ui.browser.close();
  }
});

test("a delayed write follows its prompt identity and rejects another tab without queueing", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const first = promptOperation({
    title: "First",
    description: "",
    content: "first text",
  });
  const second = promptOperation({
    title: "Second",
    description: "",
    content: "second text",
  });
  await account.mutate([first, second]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    const other = await ui.open();
    await page.getByLabel("Saved content").waitFor();
    await other.getByLabel("Saved content").waitFor();
    await page.evaluate(() => {
      window.clipboardTest.delay = true;
    });
    await page.getByRole("button", { name: "Copy First", exact: true }).click();
    await page.waitForFunction(() => Boolean(window.clipboardTest.finish));
    const pending = await client.getPrompt(first.promptId);
    expect(pending.useCount).toBe(0);
    await page.getByRole("button", { name: "Second", exact: true }).click();
    await other
      .getByRole("button", { name: "Copy Second", exact: true })
      .click();
    await other.getByText(/Copying is already in progress/u).waitFor();
    await page.bringToFront();
    await page.evaluate(() => {
      window.clipboardTest.finish?.();
    });
    await waitForCopy(page);
    const used = await client.getPrompt(first.promptId);
    const unused = await client.getPrompt(second.promptId);
    expect(used.useCount).toBe(1);
    expect(unused.useCount).toBe(0);
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "second text"
    );
    expect(await other.evaluate(() => window.clipboardTest.writes)).toEqual([]);
  } finally {
    await ui.browser.close();
  }
});

test("an account switch during a clipboard write cannot record usage or copy status in the new library", async () => {
  const account = await promptBrowser();
  const other = await promptBrowser();
  const create = promptOperation();
  const foreign = promptOperation({
    title: "Other account",
    description: "",
    content: "other",
  });
  await account.mutate([create]);
  await other.mutate([foreign]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page.getByLabel("Saved content").waitFor();
    await page.evaluate(() => {
      window.clipboardTest.delay = true;
    });
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await page.waitForFunction(() => Boolean(window.clipboardTest.finish));
    await ui.setAccount(other.Cookie);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByRole("button", { name: "Copy Other account", exact: true })
      .waitFor();
    const finished = page.waitForResponse("**/api/v1/sync/mutations");
    await page.evaluate(() => {
      window.clipboardTest.finish?.();
    });
    await finished;
    const untouched = await promptClient(other.Cookie).getPrompt(
      foreign.promptId
    );
    expect(untouched.useCount).toBe(0);
    expect(await page.getByText(/^Copied\./u).count()).toBe(0);
    expect(
      await page
        .getByRole("button", { name: "Retry usage", exact: true })
        .count()
    ).toBe(0);
  } finally {
    await ui.browser.close();
  }
});

test("usage storage rollback retains clipboard success and retry records one use", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page.getByLabel("Saved content").waitFor();
    await withUsageStorageFailure(async () => {
      await page
        .getByRole("button", { name: "Copy prompt", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Retry usage", exact: true })
        .waitFor();
      const prompt = await client.getPrompt(create.promptId);
      expect(prompt.useCount).toBe(0);
      expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
        "Hello",
      ]);
    });
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .click();
    await waitForCopy(page);
    const prompt = await client.getPrompt(create.promptId);
    expect(prompt.useCount).toBe(1);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "Hello",
    ]);
  } finally {
    await ui.browser.close();
  }
});

test("account changes during prompt preparation reject the clipboard payload before writing", async () => {
  const account = await promptBrowser();
  const other = await promptBrowser();
  const create = promptOperation();
  const foreign = promptOperation({
    title: "New library",
    description: "",
    content: "other",
  });
  await account.mutate([create]);
  await other.mutate([foreign]);
  const ui = await copyBrowser(account.Cookie);
  const release = Promise.withResolvers<undefined>();
  try {
    const page = await ui.open();
    await page.getByLabel("Saved content").waitFor();
    const requested = Promise.withResolvers<undefined>();
    await page.route(
      `**/api/v1/library/prompts/${create.promptId}`,
      async (route) => {
        const response = await route.fetch();
        requested.resolve();
        await release.promise;
        await route.fulfill({ response });
      }
    );
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await requested.promise;
    await ui.setAccount(other.Cookie);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange"))
    );
    await page
      .getByRole("button", { name: "Copy New library", exact: true })
      .waitFor();
    release.resolve();
    await page.waitForFunction(async () => {
      const locks = await navigator.locks.query();
      return !locks.held?.some((lock) => lock.name === "pr0:clipboard");
    });
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([]);
    const prompt = await promptClient(account.Cookie).getPrompt(
      create.promptId
    );
    expect(prompt.useCount).toBe(0);
  } finally {
    release.resolve();
    await ui.browser.close();
  }
});
