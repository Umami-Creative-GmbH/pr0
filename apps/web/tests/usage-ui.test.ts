import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { desktopUsageStatusSchema } from "@pr0/api-contract/desktop-copy";
import { desktopStatusSchema } from "@pr0/api-contract/desktop-session";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { z } from "zod";

import { browseKeepingDraft } from "./app-menus";
import { backToLibrary, openAccountView } from "./desktop-menus";
import { localNativeWorker } from "./local-native-worker";
import type { NativeArgs } from "./local-native-worker";

const installNativeBridge = async (page: Page) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: { payload: null }) => void>();
    let callbackId = 0;
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
      value: { unregisterListener: () => {} },
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: NativeArgs = {}) => {
          if (command === "surface_visible") {
            return true;
          }
          if (
            command === "plugin:event|listen" &&
            args.event === "auth-changed"
          ) {
            const { handler } = args;
            window.addEventListener("test-auth-changed", () => {
              // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The Tauri bridge supplies a numeric callback ID, not a domain payload.
              if (typeof handler === "number") {
                // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Tauri's event protocol invokes registered callbacks synchronously.
                callbacks.get(handler)?.({ payload: null });
              }
            });
          }
          if (command.startsWith("plugin:event|")) {
            return 1;
          }
          const result = await window.nativeCommand(command, args);
          if (command === "library_copy") {
            performance.mark("copy-delivered");
          }
          if (result.error) {
            throw result.error;
          }
          return result.ok;
        },
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Implement the callback registration required by Tauri's event protocol.
        transformCallback: (callback: (event: { payload: null }) => void) => {
          callbackId += 1;
          callbacks.set(callbackId, callback);
          return callbackId;
        },
      },
    });
  });
};

test("desktop list/detail Copy preserves failure, retries usage only and shows durable Recents", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-copy-ui-"));
  const native = await localNativeWorker(directory, true);
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "chrome",
    headless: true,
  });
  let fault = "clipboard_unavailable";
  let holdCopy = false;
  let generationChanged = false;
  const held = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<undefined>();
  try {
    const page = await browser.newPage({
      locale: "en-US",
      viewport: { width: 1100, height: 900 },
    });
    await page.exposeFunction(
      "nativeCommand",
      async (command: string, args: NativeArgs) => {
        try {
          const ok = await native.command(command, { ...args, fault });
          if (command === "library_copy" && holdCopy) {
            started.resolve();
            await held.promise;
          }
          if (command === "auth_status" && generationChanged) {
            const status = z.looseObject({ generation: z.number() }).parse(ok);
            return { ok: { ...status, generation: status.generation + 1 } };
          }
          return { ok };
        } catch (error) {
          return {
            error:
              error instanceof Error ? error.message : "native_unavailable",
          };
        }
      }
    );
    await installNativeBridge(page);
    await page.goto(
      process.env.PR0_DESKTOP_TEST_URL ?? "http://localhost:1420"
    );
    await page.getByRole("button", { name: "Copy First", exact: true }).click();
    await page
      .getByText("Could not copy. Your prompt is preserved. Try Copy again.")
      .waitFor();
    expect(
      desktopUsageStatusSchema.parse(
        await native.command("library_usage_status")
      ).waiting
    ).toBe(0);
    fault = "usage_io_error";
    await page.getByRole("button", { name: "First", exact: true }).click();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await page
      .getByText("Copied. Usage could not be saved.", { exact: false })
      .waitFor();
    expect(await native.command("test_clipboard_text")).toBe(
      "  Hello offline\n"
    );
    fault = "";
    await page
      .getByRole("button", { name: "Retry usage", exact: true })
      .click();
    await page
      .getByText("1 use(s) saved on this device, waiting to sync.", {
        exact: true,
      })
      .waitFor();
    expect(
      desktopUsageStatusSchema.parse(
        await native.command("library_usage_status")
      ).waiting
    ).toBe(1);
    await page.getByRole("button", { name: "Recents", exact: true }).click();
    await page.getByRole("button", { name: "First", exact: true }).waitFor();
    await page.getByRole("button", { name: "Recents", exact: true }).click();
    expect(
      await page.getByRole("button", { name: "First", exact: true }).count()
    ).toBe(1);
    await page.getByRole("button", { name: "Copy First", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByText("Copied.", { exact: true }).waitFor();
    expect(
      desktopUsageStatusSchema.parse(
        await native.command("library_usage_status")
      ).waiting
    ).toBe(2);
    await page.reload();
    await page.getByRole("button", { name: "Recents", exact: true }).click();
    await page.getByRole("button", { name: "First", exact: true }).waitFor();
    await page.screenshot({
      path: "docs/evidence/issue-49-offline-recents.png",
      fullPage: true,
    });
    expect(
      await page.getByRole("button", { name: "First", exact: true }).count()
    ).toBe(1);
    holdCopy = true;
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Retain this draft during sign-in");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Unsaved description");
    await page
      .getByLabel("Content", { exact: true })
      .fill("Unsaved {{content}}");
    // The editor is modal: keep the draft mounted while copying from the list.
    await browseKeepingDraft(page);
    await page.getByRole("button", { name: "Copy First", exact: true }).click();
    await started.promise;
    generationChanged = true;
    // "Check connection" lives in the account view; the library stays mounted.
    await openAccountView(page);
    await page
      .getByRole("button", { name: "Check connection", exact: true })
      .click();
    await backToLibrary(page);
    // The new UI generation is in effect once its first search is refused;
    // by the time the library is back in view its rows are already gone.
    await page
      .getByText(
        "The account changed. Refresh the connection before searching again."
      )
      .waitFor();
    // Reauthentication starts a new UI generation while the old clipboard completion is delayed.
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>(
          'button[aria-label="Copy First"]'
        )?.disabled
    );
    held.resolve();
    await page.waitForFunction(
      () => performance.getEntriesByName("copy-delivered").length === 1
    );
    expect(await page.getByLabel("Title", { exact: true }).inputValue()).toBe(
      "Retain this draft during sign-in"
    );
    expect(
      await page.getByLabel("Description", { exact: true }).inputValue()
    ).toBe("Unsaved description");
    expect(await page.getByLabel("Content", { exact: true }).inputValue()).toBe(
      "Unsaved {{content}}"
    );
    await page
      .getByText(
        "The account changed. Refresh the connection before searching again."
      )
      .waitFor();
    expect(
      await page
        .getByRole("button", { name: "Copy First", exact: true })
        .count()
    ).toBe(0);
    expect(await page.getByText("Copied.", { exact: true }).count()).toBe(0);
  } finally {
    held.resolve();
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("a new sign-in generation clears an open variable interaction", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pr0-variable-session-")
  );
  const native = await localNativeWorker(directory, true);
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "chrome",
    headless: true,
  });
  let generationChanged = false;
  try {
    const clipboardBefore = await native.command("test_clipboard_text");
    const account = desktopStatusSchema.parse(
      await native.command("auth_status")
    );
    await native.command("library_create", {
      request: {
        instanceId: account.instanceId,
        accountId: account.accountId,
        generation: account.generation,
        operationId: crypto.randomUUID(),
        promptId: crypto.randomUUID(),
        expectedLocalRevision: null,
        desired: {
          title: "Variable example",
          description: "",
          content: "Hello {{name}}",
        },
      },
    });
    const page = await browser.newPage();
    await page.exposeFunction(
      "nativeCommand",
      async (command: string, args: NativeArgs) => {
        try {
          const ok = await native.command(command, args);
          if (command === "auth_status" && generationChanged) {
            const status = desktopStatusSchema.parse(ok);
            return { ok: { ...status, generation: status.generation + 1 } };
          }
          return { ok };
        } catch (error) {
          return {
            error:
              error instanceof Error ? error.message : "native_unavailable",
          };
        }
      }
    );
    await installNativeBridge(page);
    await page.goto(
      process.env.PR0_DESKTOP_TEST_URL ?? "http://localhost:1420"
    );
    await page
      .getByRole("button", { name: "Copy Variable example", exact: true })
      .click();
    await page
      .getByLabel("name (string)", { exact: true })
      .fill("Private value");
    generationChanged = true;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("test-auth-changed"))
    );
    await page
      .getByText(
        "The account changed. Refresh the connection before searching again."
      )
      .waitFor();
    await page
      .getByLabel("name (string)", { exact: true })
      .waitFor({ state: "detached" });
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await native.command("test_clipboard_text")).toBe(clipboardBefore);
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
