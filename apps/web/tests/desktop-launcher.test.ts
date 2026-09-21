import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { desktopStatusSchema } from "@pr0/api-contract/desktop-session";

import { localNativeWorker } from "./local-native-worker";
import type { NativeArgs } from "./local-native-worker";
import { holdNativeResource } from "./native-resource";
import { nativeWebview } from "./native-webview";

declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke: (
        command: string,
        args: NativeArgs
      ) => Promise<NativeArgs[string]>;
    };
  }
}

test("production launcher uses native offline search, keyboard copy and least privilege IPC", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-launcher-"));
  const native = await localNativeWorker(directory, true);
  const account = desktopStatusSchema.parse(
    await native.command("auth_status")
  );
  // Fill more than one page through the existing native save boundary.
  for (let index = 0; index < 55; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- SQLite saves are sequential acknowledgements.
    await native.command("library_create", {
      request: {
        instanceId: account.instanceId,
        accountId: account.accountId,
        generation: account.generation,
        operationId: crypto.randomUUID(),
        promptId: crypto.randomUUID(),
        expectedLocalRevision: null,
        desired: {
          title: `Launcher ${String(index).padStart(2, "0")}`,
          description: "",
          content: `offline body ${index}`,
        },
      },
    });
  }
  await native.stop();
  const releaseClipboard = await holdNativeResource(
    native.executable,
    "launcher_clipboard_worker",
    { PR0_HOLD_CLIPBOARD: "true" }
  );
  const webview = await nativeWebview(native.executable, directory);
  try {
    const main = webview.page;
    await main
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .click();
    const [context] = webview.browser.contexts();
    if (!context) {
      throw new Error("Missing WebView context");
    }
    const launcher =
      context.pages().find((page) => page.url().includes("launcher.html")) ??
      (await context.waitForEvent("page"));
    launcher.setDefaultTimeout(8000);
    const input = launcher.getByRole("searchbox", {
      name: "Search prompts",
      exact: true,
    });
    await input.waitFor();
    await input.fill("Launcher");
    await launcher.locator('[data-search-query="Launcher"]').waitFor();
    expect(
      await launcher
        .getByRole("list", { name: "Launcher results" })
        .getByRole("button")
        .count()
    ).toBe(50);
    await launcher
      .getByRole("button", { name: "Next", exact: true })
      .press("Enter");
    await launcher.waitForFunction(
      () =>
        document.querySelectorAll('ul[aria-label="Launcher results"] button')
          .length === 5
    );
    expect(
      await launcher
        .getByRole("list", { name: "Launcher results" })
        .getByRole("button")
        .count()
    ).toBe(5);
    const denied = await launcher.evaluate(async () => {
      const results: string[] = [];
      for (const command of [
        "auth_status",
        "library_create",
        "library_copy_draft",
        "library_search",
        "relay",
        "plugin:clipboard-manager|write_text",
      ]) {
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Check each independent native denial without dispatching mutations together.
          await window.__TAURI_INTERNALS__.invoke(command, {});
          results.push("allowed");
        } catch {
          results.push("denied");
        }
      }
      return results;
    });
    expect(denied).toEqual(Array.from({ length: 6 }, () => "denied"));
    const selected = launcher
      .getByRole("list", { name: "Launcher results" })
      .getByRole("button")
      .nth(1);
    const selectedTitle = await selected.textContent();

    await input.press("ArrowDown");
    await launcher.keyboard.press("ArrowDown");
    expect(
      await selected.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    await launcher.keyboard.press("Enter");
    await launcher
      .getByRole("alert")
      .filter({ hasText: "Could not copy" })
      .waitFor();
    expect(await input.inputValue()).toBe("Launcher");
    expect(await selected.getAttribute("aria-pressed")).toBe("true");
    await releaseClipboard();
    await launcher.screenshot({ path: "docs/evidence/issue-51-launcher.png" });
    await launcher
      .getByRole("button", { name: "Copy selected prompt", exact: true })
      .press("Enter");
    await launcher.waitForFunction(async () => {
      const status = await window.__TAURI_INTERNALS__.invoke(
        "launcher_status",
        {}
      );
      return (
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Browser readiness poll; the application validates the complete native contract separately.
        typeof status === "object" &&
        status !== null &&
        "visible" in status &&
        status.visible === false
      );
    });
    await main
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .click();
    await input.waitFor();
    expect(await input.inputValue()).toBe("");
    await launcher.locator('[data-search-query=""]').waitFor();
    expect(
      await launcher
        .getByRole("list", { name: "Launcher results" })
        .getByRole("button")
        .first()
        .textContent()
    ).toBe(selectedTitle);
    expect(await launcher.getByLabel("Sort prompts").count()).toBe(0);
    expect(
      await launcher
        .getByRole("button", { name: "Archive", exact: true })
        .count()
    ).toBe(0);
    await launcher.locator("summary").filter({ hasText: "Filters" }).click();
    await launcher.getByLabel("Favorites only").check();
    await launcher.getByText("No matching prompts", { exact: true }).waitFor();
    const previousOpening = await launcher
      .locator("main")
      .getAttribute("data-opening");
    await input.press("Escape");
    await main
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .click();
    await launcher.waitForFunction(
      (previous) =>
        document.querySelector("main")?.dataset.opening !== previous,
      previousOpening
    );
    await input.waitFor();
    await launcher.locator("summary").filter({ hasText: "Filters" }).click();
    expect(await launcher.getByLabel("Favorites only").isChecked()).toBe(false);
    await input.press("Escape");
  } finally {
    await releaseClipboard?.();
    await webview.stop();
    try {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    } catch {
      /* A WebView shutdown can retain its isolated temporary profile briefly. */
    }
  }
}, 120_000);

for (const collisions of [1, 4]) {
  test(`Windows launcher preserves ${collisions} competing shortcut registrations and recovers manually`, async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "pr0-launcher-collision-")
    );
    const native = await localNativeWorker(directory, true);
    await native.stop();
    const release = await holdNativeResource(
      native.executable,
      "launcher_collision_worker",
      { PR0_LAUNCHER_COLLISIONS: String(collisions) }
    );
    const webview = await nativeWebview(native.executable, directory);
    try {
      const main = webview.page;
      await main
        .getByText(
          collisions === 4 ? "Global shortcut unavailable" : "Alt+Space",
          { exact: true }
        )
        .waitFor();
      await main
        .getByRole("button", { name: "Open quick launcher", exact: true })
        .press("Enter");
      const [context] = webview.browser.contexts();
      const launcher = context
        ?.pages()
        .find((page) => page.url().includes("launcher.html"));
      if (!launcher) {
        throw new Error("Missing launcher window");
      }
      const input = launcher.getByRole("searchbox", {
        name: "Search prompts",
        exact: true,
      });
      await input.waitFor();
      await input.press("Escape");
      await release();
      if (collisions === 4) {
        await main
          .getByRole("button", { name: "Retry registration", exact: true })
          .press("Enter");
        await main.getByText("Ctrl+Shift+P", { exact: true }).waitFor();
      }
    } finally {
      await release();
      await webview.stop();
      try {
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      } catch {
        /* The isolated WebView profile may remain locked briefly after termination. */
      }
    }
  }, 60_000);
}

test("closing the library cannot strand a hidden launcher process before tray residency", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-launcher-close-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const webview = await nativeWebview(native.executable, directory, {
    PR0_TEST_CLOSE_MAIN: "true",
  });
  try {
    await webview.page
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .waitFor();
    expect(await webview.exited).toBe(0);
  } finally {
    await webview.stop();
    try {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    } catch {
      /* The isolated profile may be released after the process exits. */
    }
  }
}, 30_000);
