import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import type { Page } from "playwright";

import { localNativeWorker } from "./local-native-worker";
import type { NativeArgs } from "./local-native-worker";

declare global {
  interface Window {
    nativeCommand: (
      command: string,
      args: NativeArgs
    ) => Promise<{ ok?: NativeArgs[string]; error?: string }>;
  }
}

const connect = async (
  page: Page,
  native: Awaited<ReturnType<typeof localNativeWorker>>,
  fault: () => string,
  after: (command: string) => Promise<void> = async () => {}
) => {
  await page.exposeFunction(
    "nativeCommand",
    async (command: string, args: NativeArgs) => {
      try {
        const ok = await native.command(command, { ...args, fault: fault() });
        await after(command);
        if (
          fault() === "malformed_response" &&
          (command === "library_create" || command === "library_edit")
        ) {
          return { ok: null };
        }
        return { ok };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "native_unavailable",
        };
      }
    }
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
      value: { unregisterListener: () => {} },
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: NativeArgs = {}) => {
          // Native events are notifications only; this test refreshes authoritative views explicitly.
          if (command.startsWith("plugin:event|")) {
            return 1;
          }
          const result = await window.nativeCommand(command, args);
          if (result.error) {
            throw result.error;
          }
          return result.ok;
        },
        transformCallback: () => 1,
      },
    });
  });
  await page.goto("http://localhost:1420");
};

test("desktop editor retains a disk-full draft then commits and reopens pending text through native commands", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-save-ui-"));
  let native = await localNativeWorker(directory);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
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
    expect(
      await page
        .getByRole("button", { name: "Sign out or change server" })
        .isEnabled()
    ).toBe(false);
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

test("two desktop windows keep competing drafts and an older save acknowledgement cannot certify newer typing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-two-window-"));
  const native = await localNativeWorker(directory);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
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
      const field = document.querySelector("#downloaded-content");
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
