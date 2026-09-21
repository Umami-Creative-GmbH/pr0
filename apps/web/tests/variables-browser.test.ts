import { expect, test } from "bun:test";

import { copyBrowser, waitForCopy } from "./copy-browser-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptEdit,
  promptDeletion,
} from "./prompt-fixture";

test("typed values copy literally without changing the saved template or usage payload", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation({
    title: "Typed template",
    description: "",
    content: "{{__proto__}} {{a}}/{{a|number}} \\{{escaped}}",
  });
  await account.mutate([create]);
  const before = await client.getPrompt(create.promptId);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Fill prompt variables" });
    await dialog
      .getByLabel("__proto__ (string)", { exact: true })
      .fill("Keep {{other}} and $&");
    await dialog.getByLabel("a (number)", { exact: true }).fill("+02.50");
    const request = page.waitForRequest("**/api/v1/sync/mutations");
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await waitForCopy(page);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "Keep {{other}} and $& +02.50/+02.50 {{escaped}}",
    ]);
    const sent = await request;
    const payload = sent.postData() ?? "";
    expect(payload).not.toContain("Keep {{other}}");
    expect(payload).not.toContain("+02.50");
    expect(await dialog.count()).toBe(0);
    const after = await client.getPrompt(create.promptId);
    expect(after.content).toBe(before.content);
    expect(after.modifiedAt).toBe(before.modifiedAt);
    expect(after.useCount).toBe(1);
  } finally {
    await ui.browser.close();
  }
});

test("blank and numeric errors preserve input; failure retains values, usage-only retry clears them", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation({
    title: "Retry variables",
    description: "",
    content: "{{x|number}} {{text}}",
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const copy = dialog.getByRole("button", { name: "Copy", exact: true });
    await dialog.getByLabel("x (number)", { exact: true }).fill("1e3");
    await dialog
      .getByLabel("text (string)", { exact: true })
      .fill("\u0085\u2000");
    await copy.click();
    await dialog.getByText(/Enter decimal text/u).waitFor();
    await dialog.getByText("Enter a nonblank value.").waitFor();
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([]);
    await dialog
      .getByLabel("x (number)", { exact: true })
      .fill("9007199254740993");
    await dialog
      .getByLabel("text (string)", { exact: true })
      .fill("  literal\n text  ");
    await page.evaluate(() => {
      window.clipboardTest.fail = true;
    });
    await copy.click();
    await dialog.getByText(/Could not copy/u).waitFor();
    expect(
      await dialog.getByLabel("text (string)", { exact: true }).inputValue()
    ).toBe("  literal\n text  ");
    const failed = await client.getPrompt(create.promptId);
    expect(failed.useCount).toBe(0);
    await page.evaluate(() => {
      window.clipboardTest.fail = false;
    });
    await page.route("**/api/v1/sync/mutations", (route) => route.abort());
    await copy.click();
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .waitFor();
    expect(await dialog.count()).toBe(0);
    await page.unroute("**/api/v1/sync/mutations");
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .click();
    await waitForCopy(page);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "9007199254740993   literal\n text  ",
      "9007199254740993   literal\n text  ",
    ]);
    const after = await client.getPrompt(create.promptId);
    expect(after.useCount).toBe(1);
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    expect(
      await dialog.getByLabel("x (number)", { exact: true }).inputValue()
    ).toBe("");
    await page.keyboard.press("Escape");
    expect(await dialog.count()).toBe(0);
    expect(
      await page
        .getByRole("button", { name: "Copy prompt", exact: true })
        .evaluate((button) => button === document.activeElement)
    ).toBe(true);
  } finally {
    await ui.browser.close();
  }
});

test("observed edits require explicit restart, revalidate surviving names and clear removed names", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation({
    title: "Changing template",
    description: "",
    content: "{{x}} {{removed}}",
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Copy Changing template", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("x (string)", { exact: true }).fill("word");
    await dialog.getByLabel("removed (string)", { exact: true }).fill("secret");
    const before = await client.getPrompt(create.promptId);
    await account.mutate([
      promptEdit(before, { ...create.desired, content: "{{x|number}} {{y}}" }),
    ]);
    await dialog
      .getByRole("button", { name: "Restart with updated template" })
      .click();
    expect(
      await dialog.getByLabel("x (number)", { exact: true }).inputValue()
    ).toBe("word");
    expect(
      await dialog.getByLabel("y (string)", { exact: true }).inputValue()
    ).toBe("");
    expect(
      await dialog.getByLabel("removed (string)", { exact: true }).count()
    ).toBe(0);
    await dialog.getByText(/Enter decimal text/u).waitFor();
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([]);
    const changed = await client.getPrompt(create.promptId);
    await account.mutate([
      promptEdit(changed, { ...create.desired, content: "{{removed}}" }),
    ]);
    await dialog
      .getByRole("button", { name: "Restart with updated template" })
      .click();
    expect(
      await dialog.getByLabel("removed (string)", { exact: true }).inputValue()
    ).toBe("");
    const again = await client.getPrompt(create.promptId);
    await account.mutate([
      promptEdit(again, { ...create.desired, content: "literal now" }),
    ]);
    await dialog
      .getByRole("button", { name: "Restart with updated template" })
      .click();
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([]);
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await waitForCopy(page);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "literal now",
    ]);
  } finally {
    await ui.browser.close();
  }
});

test("observed deletion ends filling and metadata-only changes do not restart it", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation({
    title: "Delete while filling",
    description: "",
    content: "{{x}}",
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("x (string)", { exact: true })
      .fill("private value");
    const before = await client.getPrompt(create.promptId);
    await account.mutate([
      promptEdit(before, { ...create.desired, title: "Renamed" }),
    ]);
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await waitForCopy(page);
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await dialog
      .getByLabel("x (string)", { exact: true })
      .fill("delete this value");
    const changed = await client.getPrompt(create.promptId);
    await account.mutate([promptDeletion(changed)]);
    await dialog.waitFor({ state: "detached" });
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "private value",
    ]);
  } finally {
    await ui.browser.close();
  }
});

test("bounded expansion blocks before writing without truncating values", async () => {
  const account = await promptBrowser();
  const create = promptOperation({
    title: "Large output",
    description: "",
    content: "{{x}}{{x}}",
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("x (string)", { exact: true })
      .fill("a".repeat(131_073));
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await dialog.getByText(/Combined output must/u).waitFor();
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([]);
    await dialog
      .getByLabel("x (string)", { exact: true })
      .fill("a".repeat(131_072));
    await page.evaluate(() => {
      document.addEventListener(
        "submit",
        () => performance.mark("variable-copy-start"),
        { capture: true, once: true }
      );
      const write = navigator.clipboard.write.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "write", {
        configurable: true,
        value: async (items: ClipboardItem[]) => {
          await write(items);
          performance.measure("variable-copy", "variable-copy-start");
        },
      });
    });
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await waitForCopy(page);
    expect(
      await page.evaluate(() => window.clipboardTest.writes[0]?.length)
    ).toBe(262_144);
    const measurement = await page.evaluate(() => ({
      milliseconds: performance.getEntriesByName("variable-copy")[0]?.duration,
      browser: navigator.userAgent,
      outputBytes: 262_144,
    }));
    await Bun.write(
      "docs/evidence/issue-52-copy-timing.json",
      `${JSON.stringify(measurement, null, 2)}\n`
    );
    expect(measurement.milliseconds).toBeLessThan(150);
  } finally {
    await ui.browser.close();
  }
});

test("many variables remain reachable at zoom with keyboard entry and cancellation", async () => {
  const account = await promptBrowser();
  const create = promptOperation({
    title: "Many fields",
    description: "",
    content: Array.from(
      { length: 100 },
      (_, index) => `{{field_${index}}}`
    ).join("\n"),
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("field_0 (string)", { exact: true }).focus();
    // Tab through the actual form; no field is hidden behind virtualization.
    for (let index = 0; index < 100; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Keyboard traversal is sequential.
      await page.keyboard.type(`value${index}`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- Keyboard traversal is sequential.
      await page.keyboard.press("Tab");
    }
    expect(
      await dialog.getByLabel("field_99 (string)", { exact: true }).inputValue()
    ).toBe("value99");
    // The dialog keeps its heading and actions fixed; its body scrolls.
    expect(
      await dialog
        .getByRole("group", { name: "Variable values", exact: true })
        .evaluate((element) => (element.parentElement?.scrollTop ?? 0) > 0)
    ).toBe(true);
    await page.screenshot({
      path: "docs/evidence/issue-52-variables-zoom.png",
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    expect(
      await dialog.getByLabel("field_99 (string)", { exact: true }).inputValue()
    ).toBe("");
  } finally {
    await ui.browser.close();
  }
});

test("account switches and page exit clear filled values, including a pending OS write", async () => {
  const account = await promptBrowser();
  const other = await promptBrowser();
  const create = promptOperation({
    title: "Original account",
    description: "",
    content: "{{x}}",
  });
  const foreign = promptOperation({
    title: "Other account",
    description: "",
    content: "{{x}}",
  });
  await account.mutate([create]);
  await other.mutate([foreign]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("x (string)", { exact: true }).fill("page-only");
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true })
      );
    });
    await dialog.waitFor({ state: "detached" });
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    expect(
      await dialog.getByLabel("x (string)", { exact: true }).inputValue()
    ).toBe("");
    await dialog
      .getByLabel("x (string)", { exact: true })
      .fill("old-account-only");
    await page.evaluate(() => {
      window.clipboardTest.delay = true;
    });
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await page.waitForFunction(() => Boolean(window.clipboardTest.finish));
    await ui.setAccount(other.Cookie);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByRole("button", { name: "Copy Other account", exact: true })
      .waitFor();
    expect(await dialog.count()).toBe(0);
    const finished = page.waitForResponse("**/api/v1/sync/mutations");
    await page.evaluate(() => {
      window.clipboardTest.finish?.();
    });
    await finished;
    expect(await page.getByText(/^Copied\./u).count()).toBe(0);
    const untouched = await promptClient(other.Cookie).getPrompt(
      foreign.promptId
    );
    expect(untouched.useCount).toBe(0);
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    expect(
      await dialog.getByLabel("x (string)", { exact: true }).inputValue()
    ).toBe("");
    const browserStorage = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        url: location.href,
      })
    );
    expect(browserStorage).not.toContain("old-account-only");
    expect(browserStorage).not.toContain("page-only");
  } finally {
    await ui.browser.close();
  }
});

test("escaped templates without fields copy directly and archived templates still accept values", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const escaped = promptOperation({
    title: "Escaped",
    description: "",
    content: "\\\\{{name}} \\{{bad|unknown}}",
  });
  const archived = promptOperation({
    title: "Archive template",
    description: "",
    content: "{{x}}",
  });
  await account.mutate([escaped, archived]);
  const source = await client.getPrompt(archived.promptId);
  await account.mutate([
    {
      kind: "prompt.update",
      operationId: crypto.randomUUID(),
      promptId: source.id,
      baseRevision: source.revision,
      dependsOn: [],
      base: { ...archived.desired, archived: false },
      desired: { ...archived.desired, archived: true },
      changedFields: ["archived"],
    },
  ]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Copy Escaped", exact: true })
      .click();
    await waitForCopy(page);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "\\{{name}} \\{{bad|unknown}}",
    ]);
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page
      .getByRole("button", { name: "Copy Archive template", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("x (string)", { exact: true })
      .fill("archived value");
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await waitForCopy(page);
    expect(await page.evaluate(() => window.clipboardTest.writes.at(-1))).toBe(
      "archived value"
    );
  } finally {
    await ui.browser.close();
  }
});

test("pending writes freeze inputs and Escape; cancellation clears values", async () => {
  const account = await promptBrowser();
  const create = promptOperation({
    title: "Frozen output",
    description: "",
    content: "{{x}}",
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("x (string)", { exact: true }).fill("frozen");
    await page.evaluate(() => {
      window.clipboardTest.delay = true;
    });
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await page.waitForFunction(() => Boolean(window.clipboardTest.finish));
    expect(
      await dialog.getByLabel("x (string)", { exact: true }).isDisabled()
    ).toBe(true);
    expect(
      await dialog.getByRole("button", { name: "Cancel" }).isDisabled()
    ).toBe(true);
    await page.keyboard.press("Escape");
    expect(await dialog.count()).toBe(1);
    await page.evaluate(() => {
      window.clipboardTest.finish?.();
    });
    await waitForCopy(page);
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    expect(
      await dialog.getByLabel("x (string)", { exact: true }).inputValue()
    ).toBe("");
    await dialog.getByLabel("x (string)", { exact: true }).fill("cancelled");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    expect(
      await dialog.getByLabel("x (string)", { exact: true }).inputValue()
    ).toBe("");
  } finally {
    await ui.browser.close();
  }
});

test("a retained editor draft can copy again after switching away during a write and returning", async () => {
  const account = await promptBrowser();
  const other = await promptBrowser();
  const create = promptOperation({
    title: "Retained draft",
    description: "",
    content: "{{x}}",
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Title (required)", exact: true })
      .fill("Unsaved title");
    await page
      .getByRole("button", { name: "Copy saved prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Fill prompt variables",
      exact: true,
    });
    await dialog
      .getByLabel("x (string)", { exact: true })
      .fill("first account");
    await page.evaluate(() => {
      window.clipboardTest.delay = true;
    });
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await page.waitForFunction(() => Boolean(window.clipboardTest.finish));
    await ui.setAccount(other.Cookie);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByText(/Your browser is now signed in to a different account/u)
      .waitFor();
    await dialog.waitFor({ state: "detached" });
    const completed = page.waitForResponse("**/api/v1/sync/mutations");
    await page.evaluate(() => {
      window.clipboardTest.finish?.();
      window.clipboardTest.delay = false;
    });
    await completed;
    await ui.setAccount(account.Cookie);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByText(/Your browser is now signed in to a different account/u)
      .waitFor({ state: "detached" });
    expect(
      await page
        .getByRole("textbox", { name: "Title (required)", exact: true })
        .inputValue()
    ).toBe("Unsaved title");
    await page
      .getByRole("button", { name: "Copy saved prompt", exact: true })
      .click();
    expect(
      await dialog.getByLabel("x (string)", { exact: true }).inputValue()
    ).toBe("");
    await dialog
      .getByLabel("x (string)", { exact: true })
      .fill("explicit new copy");
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await waitForCopy(page);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "first account",
      "explicit new copy",
    ]);
  } finally {
    await ui.browser.close();
  }
});

test("a late usage-only retry cannot publish copy status after an account transition", async () => {
  const account = await promptBrowser();
  const other = await promptBrowser();
  const create = promptOperation({
    title: "Usage transition",
    description: "",
    content: "{{x}}",
  });
  await account.mutate([create]);
  const ui = await copyBrowser(account.Cookie);
  const release = Promise.withResolvers<undefined>();
  try {
    const page = await ui.open();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Title (required)", exact: true })
      .fill("Keep my draft");
    await page
      .getByRole("button", { name: "Copy saved prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Fill prompt variables",
      exact: true,
    });
    await dialog.getByLabel("x (string)", { exact: true }).fill("copied once");
    await page.route("**/api/v1/sync/mutations", (route) => route.abort());
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .waitFor();
    await page.unroute("**/api/v1/sync/mutations");
    const requested = Promise.withResolvers<undefined>();
    await page.route("**/api/v1/sync/mutations", async (route) => {
      const response = await route.fetch();
      requested.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .click();
    await requested.promise;
    await ui.setAccount(other.Cookie);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByText(/Your browser is now signed in to a different account/u)
      .waitFor();
    const response = page.waitForResponse("**/api/v1/sync/mutations");
    release.resolve();
    await response;
    await ui.setAccount(account.Cookie);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await page
      .getByText(/Your browser is now signed in to a different account/u)
      .waitFor({ state: "detached" });
    expect(await page.getByText(/^Copied\./u).count()).toBe(0);
    expect(await page.evaluate(() => window.clipboardTest.writes)).toEqual([
      "copied once",
    ]);
    // Returning to the retained account also refreshes its scoped list/detail.
    // Wait for an eligible saved prompt before starting another interaction.
    await page.getByLabel("Saved content").waitFor();
    await page
      .getByRole("button", { name: "Copy saved prompt", exact: true })
      .click();
    expect(
      await dialog.getByLabel("x (string)", { exact: true }).inputValue()
    ).toBe("");
  } finally {
    release.resolve();
    await ui.browser.close();
  }
});
