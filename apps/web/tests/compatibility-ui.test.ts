import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { closeSyncStatus, syncStatus } from "./desktop-menus";
import { localNativeWorker } from "./local-native-worker";
import type { NativeArgs } from "./local-native-worker";

test("desktop incompatible server shows update recovery and retains exact saved work for keyboard browsing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-upgrade-ui-"));
  const native = await localNativeWorker(
    directory,
    true,
    false,
    false,
    "debug",
    true
  );
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 1000 },
    });
    await page.exposeFunction(
      "nativeCommand",
      async (command: string, args: NativeArgs) => {
        try {
          return { ok: await native.command(command, args) };
        } catch (error) {
          return {
            error:
              error instanceof Error ? error.message : "native_unavailable",
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
    await page.goto(
      process.env.PR0_DESKTOP_TEST_URL ?? "http://localhost:1420"
    );
    // Decomposed on purpose: the saved variant must not be normalized.
    const exactVariant = "  Exact ß é variant\n";
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Retained across versions");
    await page.getByLabel("Content", { exact: true }).fill(exactVariant);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("button", { name: "Retained across versions", exact: true })
      .click();
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    const pending = await native.command("library_pending");
    await native.command("library_upload");
    await page.reload();
    // The status label is now a span inside the focusable popover summary.
    const summary = syncStatus(page)
      .locator("summary.wf-sync")
      .filter({
        has: page.getByText("Update required · Changes waiting", {
          exact: true,
        }),
      });
    await summary.focus();
    await page.keyboard.press("Enter");
    await page
      .getByText("Sync paused because this desktop", { exact: false })
      .waitFor();
    // The open popover overlays the results; Escape dismisses it.
    await closeSyncStatus(page);
    await page
      .getByRole("button", { name: "Retained across versions", exact: true })
      .click();
    // The detail shows content in a labelled read-only field over a painted copy.
    await page.getByLabel("Prompt content", { exact: true }).waitFor();
    expect(
      await page.getByLabel("Prompt content", { exact: true }).inputValue()
    ).toBe(exactVariant);
    expect(await native.command("library_pending")).toEqual(pending);
    await page.screenshot({
      path: ".scratch/issue58-compatibility-recovery.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
