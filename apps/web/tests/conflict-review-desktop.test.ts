import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { localNativeWorker } from "./local-native-worker";
import type { NativeArgs } from "./local-native-worker";

test("desktop review remains available offline and acknowledgement survives native restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-conflict-ui-"));
  let native = await localNativeWorker(directory, true);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    await native.command("library_refresh_conflicts");
    await native.command("library_refresh_adjustments");
    const page = await browser.newPage({ locale: "en-US" });
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
    await page.goto("http://localhost:1420");
    await page.getByText("Conflicts to review", { exact: true }).click();
    await page
      .getByText("Original permanently deleted.", { exact: true })
      .waitFor();
    await page
      .getByText("Other device's complete title", { exact: false })
      .waitFor();
    expect(
      await page
        .getByRole("button", { name: "Open original", exact: true })
        .count()
    ).toBe(0);
    await page
      .getByRole("button", { name: "Mark reviewed", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByText(
        "Review saved on this device. Prompts and retained titles were kept."
      )
      .waitFor();
    const statusDetails = page.locator("details").filter({
      has: page.getByRole("button", {
        name: "Retry sync",
        exact: true,
        includeHidden: true,
      }),
    });
    await statusDetails.locator("summary").first().click();
    await page
      .getByRole("heading", {
        name: "Organization adjustments to review",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Mark adjustment reviewed", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByText(
        "Organization notice reviewed on this device. Your prompts were kept.",
        { exact: true }
      )
      .waitFor();
    await native.stop();
    native = await localNativeWorker(directory, true);
    const result = await native.command("library_conflicts");
    expect(result).toMatchObject({ notices: [] });
    expect(await native.command("library_adjustments")).toMatchObject({
      notices: [],
    });
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
