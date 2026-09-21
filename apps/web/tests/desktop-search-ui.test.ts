import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { localNativeWorker } from "./local-native-worker";
import type { NativeArgs } from "./local-native-worker";

test("desktop search preserves scope, selection, sort memory and explicit no-match actions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-search-ui-"));
  const native = await localNativeWorker(directory, true);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
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
      process.env.PR0_DESKTOP_TEST_URL ?? "http://localhost:14250"
    );
    const search = page.getByRole("searchbox", {
      name: "Search downloaded prompts",
    });
    await search.fill("Second", { timeout: 3000 });
    await page.getByRole("button", { name: "Second", exact: true }).waitFor();
    expect(
      await page.getByRole("button", { name: "First", exact: true }).count()
    ).toBe(0);
    await page.getByLabel("Sort prompts").selectOption("oldest");
    await search.fill("second offline");
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("oldest");
    await search.fill("no-such-prompt");
    await page.getByText("No matching prompts", { exact: true }).waitFor();
    expect(await search.inputValue()).toBe("no-such-prompt");
    await page
      .getByRole("button", { name: "Clear query", exact: true })
      .click();
    await page.getByRole("button", { name: "First", exact: true }).waitFor();
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe(
      "recently-modified"
    );
    await page.getByLabel("Sort prompts").selectOption("title");
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await page.getByText("No favorites yet.", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "All downloaded prompts", exact: true })
      .click();
    await page.getByRole("button", { name: "First", exact: true }).waitFor();
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("title");
    await page.reload();
    await page.getByRole("button", { name: "First", exact: true }).waitFor();
    expect(await search.inputValue()).toBe("");
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("title");
    await page.screenshot({
      path: "docs/evidence/issue-50-desktop-search.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
