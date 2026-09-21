import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { localPromptSchema } from "@pr0/api-contract/local-prompts";
import { chromium } from "playwright";

import { browseKeepingDraft, resumeDraft } from "./app-menus";
import {
  backToLibrary,
  choosePromptAction,
  closeSyncStatus,
  openAccountView,
  openSyncStatus,
} from "./desktop-menus";
import { connect } from "./local-native-ui";
import { localNativeWorker } from "./local-native-worker";

const browserChannel = process.env.PR0_TEST_BROWSER ?? "chrome";

test("navigation away from an opened duplicate survives a busy search retry", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pr0-copy-navigation-")
  );
  const native = await localNativeWorker(directory, true);
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
  });
  let busySearch = false;
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await connect(
      page,
      native,
      () => "",
      (command) => {
        if (command === "library_search" && busySearch) {
          busySearch = false;
          throw new Error("search_busy");
        }
      }
    );
    await page.getByRole("button", { name: "First", exact: true }).click();
    const detail = page.getByRole("article", { name: "Prompt detail" });
    await choosePromptAction(detail, "Duplicate");
    await detail
      .getByRole("heading", { name: "First (copy)", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "First (copy)", exact: true })
      .waitFor();
    busySearch = true;
    await page
      .getByRole("navigation", { name: "Library views" })
      .getByRole("button", { name: "Recents", exact: true })
      .click();
    await page
      .getByText("Copied active prompts appear in Recents.", { exact: false })
      .waitFor();
    await detail.waitFor({ state: "detached" });
    expect(busySearch).toBe(false);
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovery retains the selected prompt and open draft through pause and epoch activation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-recovery-ui-"));
  const native = await localNativeWorker(directory, false, false, true);
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await connect(page, native, () => "");
    page.on("pageerror", (error) => process.stderr.write(`${error.message}\n`));

    await page.getByRole("button", { name: "First", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page
      .getByLabel("Content", { exact: true })
      .fill("My unsaved draft survives replacement");
    await native.command("test_recovery");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    // The editor is modal: keep the draft mounted while using the library.
    await browseKeepingDraft(page);
    await openSyncStatus(page);
    await page
      .getByText(
        "Download paused. Resume when you are ready; local work is retained."
      )
      .waitFor();
    expect(await page.getByLabel("Content", { exact: true }).inputValue()).toBe(
      "My unsaved draft survives replacement"
    );
    await page
      .getByRole("button", { name: "Resume download", exact: true })
      .click();
    await page
      .getByText("Library downloaded at revision 3. Available offline.")
      .waitFor();
    expect(await page.getByLabel("Content", { exact: true }).inputValue()).toBe(
      "My unsaved draft survives replacement"
    );
    await closeSyncStatus(page);
    await page
      .getByText("Review pre-recovery library (2 retained prompts)", {
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Show retained prompts", exact: true })
      .click();
    await page
      .locator("details")
      .filter({
        has: page.getByRole("button", {
          name: "Show retained prompts",
          exact: true,
        }),
      })
      .getByRole("button", { name: "First", exact: true })
      .click();
    expect(await page.getByLabel("Retained prompt").textContent()).toContain(
      "  Hello offline\n"
    );
    await page.screenshot({
      path: ".scratch/issue47-recovery.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("desktop editor retains a disk-full draft then commits and reopens pending text through native commands", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-save-ui-"));
  let native = await localNativeWorker(directory);
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
  });
  let fault = "disk_full";
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => process.stderr.write(`${error.message}\n`));
    page.setDefaultTimeout(10_000);
    await connect(page, native, () => fault);
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Durable offline");
    const content = `  ${"complete draft ".repeat(4000)}\n`;
    await page.getByLabel("Content", { exact: true }).fill(content);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Not saved", { exact: true }).waitFor();
    await page.screenshot({
      path: ".scratch/issue41-disk-full.png",
      fullPage: true,
    });
    expect(await page.getByLabel("Content", { exact: true }).inputValue()).toBe(
      content
    );
    await page.getByRole("button", { name: "Copy text", exact: true }).click();
    await page.getByText("Text copied.", { exact: true }).waitFor();
    fault = "io_error";
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page
      .getByText("The device could not save this draft.", { exact: false })
      .waitFor();
    fault = "after_commit_error";
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page
      .getByText("The save could not be confirmed.", { exact: false })
      .waitFor();
    expect(await page.getByLabel("Content", { exact: true }).inputValue()).toBe(
      content
    );
    fault = "malformed_response";
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page
      .getByText("The save could not be confirmed.", { exact: false })
      .waitFor();
    fault = "";
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    expect(await page.getByLabel("Prompt editor").count()).toBe(0);
    await page
      .getByText("Changes waiting to sync", { exact: false })
      .first()
      .waitFor();
    await openAccountView(page);
    expect(
      await page
        .getByRole("button", { name: "Sign out or change server" })
        .isEnabled()
    ).toBe(true);
    await page.screenshot({
      path: ".scratch/issue41-offline-save.png",
      fullPage: true,
    });
    await page.close();
    await native.stop();
    native = await localNativeWorker(directory);
    const reopened = await browser.newPage();
    await connect(reopened, native, () => "");
    await reopened
      .getByRole("button", { name: "Durable offline", exact: true })
      .click();
    expect(await reopened.getByLabel("Prompt content").inputValue()).toBe(
      content
    );
    await reopened.getByText("Saved on this device", { exact: true }).waitFor();
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("settings cancel, failed synchronization and explicit offline discard preserve the correct library across restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-transition-ui-"));
  let native = await localNativeWorker(directory);
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await connect(page, native, () => "");
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Pending during sign-out");
    await page
      .getByLabel("Content", { exact: true })
      .fill("Keep my exact pending text\n");
    // Sign-out lives in the account view; reach it while keeping the draft.
    await browseKeepingDraft(page);
    await openAccountView(page);
    expect(
      await page
        .getByRole("button", { name: "Sign out or change server" })
        .isDisabled()
    ).toBe(true);
    await backToLibrary(page);
    await resumeDraft(page);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    await openAccountView(page);
    await page
      .getByRole("button", { name: "Sign out or change server" })
      .click();
    await page
      .getByRole("button", { name: "Cancel sign-out", exact: true })
      .click();
    expect(await page.getByLabel("Prompt content").inputValue()).toBe(
      "Keep my exact pending text\n"
    );
    await page
      .getByRole("button", { name: "Sign out or change server" })
      .click();
    await page
      .getByRole("button", { name: "Synchronize first and sign out" })
      .click();
    await page
      .getByText("Synchronization did not complete.", { exact: false })
      .waitFor();
    expect(await page.getByLabel("Prompt content").inputValue()).toBe(
      "Keep my exact pending text\n"
    );
    await page.close();
    await native.stop();
    native = await localNativeWorker(directory);
    const reopened = await browser.newPage();
    await connect(reopened, native, () => "");
    await reopened
      .getByRole("button", { name: "Pending during sign-out", exact: true })
      .click();
    expect(await reopened.getByLabel("Prompt content").inputValue()).toBe(
      "Keep my exact pending text\n"
    );
    await openAccountView(reopened);
    await reopened
      .getByRole("button", { name: "Sign out or change server" })
      .click();
    const discard = reopened.getByRole("button", {
      name: "Discard local work and sign out",
    });
    expect(await discard.isDisabled()).toBe(true);
    await reopened
      .getByLabel(
        "I understand that pending changes on this device will be lost"
      )
      .check();
    await reopened.screenshot({
      path: ".scratch/issue48-sign-out.png",
      fullPage: true,
    });
    await discard.click();
    await reopened
      .getByRole("heading", { name: "Sign in to pr0", exact: true })
      .waitFor();
    await reopened
      .getByText("Server revocation could not be confirmed", { exact: false })
      .waitFor();
    expect(await reopened.getByLabel("Downloaded library").count()).toBe(0);
    const customServer = reopened.getByRole("button", {
      name: "Use your own server",
      exact: true,
    });
    if (await customServer.count()) {
      await customServer.click();
    }
    expect(await reopened.getByLabel("HTTPS server").isEditable()).toBe(true);
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("two desktop windows keep competing drafts and an older save acknowledgement cannot certify newer typing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-two-window-"));
  const native = await localNativeWorker(directory);
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
  });
  const { promise: held, resolve: release } =
    Promise.withResolvers<undefined>();
  let delay = false;
  const { promise: accepted, resolve: committed } =
    Promise.withResolvers<undefined>();
  try {
    const first = await browser.newPage();
    await connect(
      first,
      native,
      () => "",
      async (command) => {
        if (delay && command === "library_edit") {
          committed();
          await held;
        }
      }
    );
    await first
      .getByRole("button", { name: "New prompt", exact: true })
      .click();
    await first.getByLabel("Title", { exact: true }).fill("Shared prompt");
    await first.getByLabel("Content", { exact: true }).fill("Original");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await first.getByText("Saved on this device", { exact: true }).waitFor();
    const second = await browser.newPage();
    await connect(second, native, () => "");
    await second
      .getByRole("button", { name: "Shared prompt", exact: true })
      .click();
    await second
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await first
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await first
      .getByLabel("Content", { exact: true })
      .fill("First window saved");
    await second
      .getByLabel("Content", { exact: true })
      .fill("Second window complete draft");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await first.getByLabel("Prompt editor").waitFor({ state: "detached" });
    await second.evaluate(() => window.dispatchEvent(new Event("focus")));
    await second.waitForFunction(() => {
      const field = document.querySelector(
        'textarea[aria-label="Prompt content"]'
      );
      return (
        field instanceof HTMLTextAreaElement &&
        field.value === "First window saved"
      );
    });
    await second.getByRole("button", { name: "Save", exact: true }).click();
    await second
      .getByText("The library changed in another window", { exact: false })
      .waitFor();
    expect(
      await second.getByLabel("Content", { exact: true }).inputValue()
    ).toBe("Second window complete draft");
    await second.screenshot({
      path: ".scratch/issue41-two-window.png",
      fullPage: true,
    });
    await first
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await first
      .getByLabel("Content", { exact: true })
      .fill("Submitted variant");
    await first.getByRole("button", { name: "Cancel", exact: true }).click();
    delay = true;
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await accepted;
    expect(
      await first
        .getByRole("button", { name: "Discard draft", exact: true })
        .isDisabled()
    ).toBe(true);
    await first
      .getByLabel("Content", { exact: true })
      .fill("Newer unsaved typing");
    release();
    await first.getByText("Unsaved changes", { exact: true }).waitFor();
    expect(
      await first.getByLabel("Content", { exact: true }).inputValue()
    ).toBe("Newer unsaved typing");
    expect(await first.getByLabel("Prompt content").inputValue()).toBe(
      "First window saved"
    );
    delay = false;
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await first.getByLabel("Prompt editor").waitFor({ state: "detached" });
    expect(await first.getByLabel("Prompt content").inputValue()).toBe(
      "Newer unsaved typing"
    );
  } finally {
    release();
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("an open draft follows its conflict copy without replacing text and offers the retained original", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-upload-ui-"));
  const native = await localNativeWorker(directory, true);
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await connect(page, native, () => "");
    const original = localPromptSchema.parse(
      await native.command("library_editor", {
        id: "66666666-6666-4666-8666-666666666666",
      })
    );
    await page
      .getByRole("button", { name: original.prompt.title, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    // Located by attribute: the form stays mounted but hidden while browsing.
    const editor = page.locator('form[aria-label="Prompt editor"]');
    await editor.getByLabel("Content", { exact: true }).fill("B1 saved text");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await editor
      .getByLabel("Content", { exact: true })
      .fill("B2 unsaved complete text");
    await native.command("library_upload");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page
      .getByText(
        "You're editing the conflict copy. Your unsaved text is retained."
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Open original", exact: true })
      .waitFor();
    expect(
      await editor.getByLabel("Content", { exact: true }).inputValue()
    ).toBe("B2 unsaved complete text");
    await page.screenshot({
      path: "docs/evidence/issue-42-conflict-draft.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Open original", exact: true })
      .click();
    expect(
      await editor.getByLabel("Content", { exact: true }).inputValue()
    ).toBe("B2 unsaved complete text");
    // "Open original" browses the library; return to the kept draft to save.
    await resumeDraft(page);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    const copy = localPromptSchema.parse(
      await native.command("library_editor", {
        id: "99999999-9999-4999-8999-999999999999",
      })
    );
    expect(copy.prompt.content).toBe("B2 unsaved complete text");
    const preserved = localPromptSchema.parse(
      await native.command("library_editor", { id: original.prompt.id })
    );
    expect(preserved.prompt.content).toBe(original.prompt.content);
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a remote deletion selects the remaining result while preserving the deleted prompt's open unsaved draft", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pr0-live-delete-ui-")
  );
  const native = await localNativeWorker(directory, true);
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await connect(page, native, () => "");
    const original = localPromptSchema.parse(
      await native.command("library_editor", {
        id: "66666666-6666-4666-8666-666666666666",
      })
    );
    await page
      .getByRole("button", { name: original.prompt.title, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    const draft = page
      .getByRole("form", { name: "Prompt editor" })
      .getByLabel("Content", { exact: true });
    await draft.fill("Keep this unsaved draft");
    await native.command("library_changes");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page
      .getByRole("article", { name: "Prompt detail" })
      .getByRole("heading", { name: "Second", exact: true })
      .waitFor();
    expect(
      await page
        .getByRole("article", { name: "Prompt detail" })
        .getByRole("heading", { name: original.prompt.title, exact: true })
        .count()
    ).toBe(0);
    expect(await draft.inputValue()).toBe("Keep this unsaved draft");
    expect(
      await draft.evaluate((element) => element === document.activeElement)
    ).toBe(true);
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("desktop lifecycle resolves an uncertain commit before another action, preserves an archived favorite and cancels deletion", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-lifecycle-ui-"));
  const native = await localNativeWorker(directory);
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
  });
  let fault = "";
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await connect(page, native, () => fault);
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Lifecycle example");
    await page
      .getByLabel("Content", { exact: true })
      .fill("  Original snapshot\n");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const detail = page.getByRole("article", { name: "Prompt detail" });
    const favorite = detail.getByRole("button", {
      name: "Favorite prompt",
      exact: true,
    });
    // The row name is the title; its archived state is visible row text.
    const archivedRow = page
      .getByRole("list", { name: "Search results" })
      .getByRole("button", { name: "Lifecycle example", exact: true })
      .filter({ hasText: "(Archived)" });
    fault = "after_commit_error";
    await favorite.click();
    await page
      .getByText(
        "The result could not be confirmed. Retry to check this same action safely.",
        { exact: true }
      )
      .waitFor();
    expect(await page.getByText("Not saved.", { exact: false }).count()).toBe(
      0
    );
    fault = "";
    await page
      .getByRole("button", { name: "Retry action", exact: true })
      .click();
    await detail
      .getByRole("button", {
        name: "Favorite prompt",
        exact: true,
        pressed: true,
      })
      .waitFor();
    await choosePromptAction(detail, "Archive");
    await page
      .getByRole("navigation", { name: "Library views" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await archivedRow.click();
    await choosePromptAction(detail, "Duplicate");
    await detail
      .getByRole("heading", { name: "Lifecycle example (copy)", exact: true })
      .waitFor();
    await favorite.click();
    await detail
      .getByRole("button", {
        name: "Favorite prompt",
        exact: true,
        pressed: true,
      })
      .waitFor();
    expect(await page.getByLabel("Prompt content").inputValue()).toBe(
      "  Original snapshot\n"
    );
    await choosePromptAction(detail, "Delete permanently");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(await page.getByLabel("Prompt content").inputValue()).toBe(
      "  Original snapshot\n"
    );
    await choosePromptAction(detail, "Delete permanently");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Permanently delete", exact: true })
      .click();
    await page
      .getByText("Saved on this device. Deletion is waiting to sync.", {
        exact: true,
      })
      .waitFor();
    expect(
      await native.command("library_list", { offset: 0, view: "archive" })
    ).toEqual([
      expect.objectContaining({ title: "Lifecycle example", archived: true }),
    ]);
    await archivedRow.click();
    await choosePromptAction(detail, "Restore");
    await page
      .getByRole("navigation", { name: "Library views" })
      .getByRole("button", { name: "Favorites", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Lifecycle example", exact: true })
      .waitFor();
    const status = await openSyncStatus(page);
    await status.getByText("Review pending changes", { exact: false }).click();
    await page.screenshot({
      path: "docs/evidence/issue-44-offline-lifecycle.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
