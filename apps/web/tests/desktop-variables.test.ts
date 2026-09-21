import { expect, test } from "bun:test";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { launcherStatusSchema } from "@pr0/api-contract/desktop-launcher";
import { desktopStatusSchema } from "@pr0/api-contract/desktop-session";
import { localPromptSchema } from "@pr0/api-contract/local-prompts";
import type { Page } from "playwright";

import { localNativeWorker } from "./local-native-worker";
import { holdNativeResource } from "./native-resource";
import { nativeWebview } from "./native-webview";

const measureCopy = async (page: Page) => {
  await page.evaluate(() => {
    performance.clearMeasures("copy-confirmation");
    const button = [...document.querySelectorAll("dialog button")].find(
      (element) => element.textContent === "Copy"
    );
    button?.addEventListener(
      "click",
      () => {
        performance.mark("copy-activated");
        const observer = new MutationObserver(() => {
          if (!document.querySelector("dialog")) {
            performance.mark("copy-confirmed");
            performance.measure(
              "copy-confirmation",
              "copy-activated",
              "copy-confirmed"
            );
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      },
      { once: true }
    );
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const duration = await page.evaluate(
    () => performance.getEntriesByName("copy-confirmation")[0]?.duration
  );
  if (duration === undefined) {
    throw new Error("Copy confirmation was not measured");
  }
  return duration;
};

test("offline desktop variable entry preserves launcher navigation and copies only on final activation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-variable-ui-"));
  const native = await localNativeWorker(directory, true);
  const account = desktopStatusSchema.parse(
    await native.command("auth_status")
  );
  const promptId = crypto.randomUUID();
  await native.command("library_create", {
    request: {
      instanceId: account.instanceId,
      accountId: account.accountId,
      generation: account.generation,
      operationId: crypto.randomUUID(),
      promptId,
      expectedLocalRevision: null,
      desired: {
        title: "Variable example",
        description: "",
        content: "Hello {{name}} / {{count|number}}",
      },
    },
  });
  await native.stop();
  const profile = await mkdtemp(path.join(tmpdir(), "pr0-variable-profile-"));
  const gate = path.join(profile, "clipboard-gate");
  const webview = await nativeWebview(native.executable, directory, {
    PR0_TEST_WEBVIEW_PROFILE: profile,
    PR0_TEST_CLIPBOARD_GATE: gate,
  });
  let releaseClipboard: (() => Promise<void>) | undefined;
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
    const search = launcher.getByRole("searchbox", {
      name: "Search prompts",
      exact: true,
    });
    await search.fill("Variable example");
    await launcher.getByRole("button", { name: /^Variable example/u }).click();
    const name = launcher.getByLabel("name (string)", { exact: true });
    await name.fill("private");
    await name.press("Escape");
    expect(await search.inputValue()).toBe("Variable example");
    await launcher
      .getByRole("button", { name: "Copy selected prompt", exact: true })
      .click();
    expect(await name.inputValue()).toBe("");
    await name.fill("  Ada\nLovelace  ");
    await launcher.getByLabel("count (number)", { exact: true }).fill("1e3");
    await launcher.getByRole("button", { name: "Copy", exact: true }).click();
    await launcher.getByText("Enter decimal text", { exact: false }).waitFor();
    await launcher.getByLabel("count (number)", { exact: true }).fill("+02.50");
    releaseClipboard = await holdNativeResource(
      native.executable,
      "launcher_clipboard_worker",
      { PR0_HOLD_CLIPBOARD: "true" }
    );
    await Bun.write(gate, "");
    await launcher.getByRole("button", { name: "Copy", exact: true }).click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Wait for admission at the external clipboard test boundary.
      if (await Bun.file(`${gate}.entered`).exists()) {
        break;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Yield while the native worker reaches the clipboard boundary.
      await Bun.sleep(20);
    }
    expect(await Bun.file(`${gate}.entered`).exists()).toBe(true);
    expect(await name.isDisabled()).toBe(true);
    expect(
      await launcher
        .getByRole("button", { name: "Back", exact: true })
        .isDisabled()
    ).toBe(true);
    await launcher.keyboard.press("Escape");
    const partition = desktopStatusSchema.parse(
      await main.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("auth_status", {})
      )
    );
    const collision = await main.evaluate(
      async (request) => {
        try {
          await window.__TAURI_INTERNALS__.invoke("library_copy", { request });
          return "unexpected copy";
        } catch (error) {
          return String(error);
        }
      },
      {
        instanceId: partition.instanceId,
        accountId: partition.accountId,
        generation: partition.generation,
        promptId,
        template: "Hello {{name}} / {{count|number}}",
        values: [
          ["name", "other window"],
          ["count", "1"],
        ],
      }
    );
    expect(collision).toBe("clipboard_busy");
    await launcher.waitForFunction(async () => {
      const status = await window.__TAURI_INTERNALS__.invoke(
        "launcher_status",
        {}
      );
      return (
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Poll the observed native focus event, not browser-tab activation.
        typeof status === "object" &&
        status !== null &&
        "focused" in status &&
        status.focused === false
      );
    });
    await unlink(gate);
    await launcher
      .getByRole("status")
      .filter({ hasText: "Could not copy" })
      .waitFor();
    expect(await launcher.getByRole("dialog").isVisible()).toBe(true);
    const failedStatus = launcherStatusSchema.parse(
      await launcher.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("launcher_status", {})
      )
    );
    expect(failedStatus.visible).toBe(true);
    expect(failedStatus.focused).toBe(false);
    expect(await name.inputValue()).toBe("  Ada\nLovelace  ");
    expect(
      await launcher.getByLabel("count (number)", { exact: true }).inputValue()
    ).toBe("+02.50");
    await releaseClipboard();
    await launcher.bringToFront();
    await launcher.screenshot({ path: "docs/evidence/issue-53-variables.png" });
    const latency = await measureCopy(launcher);
    expect(latency).toBeDefined();
    await Bun.write(
      ".scratch/desktop-variable-latency.json",
      JSON.stringify({ milliseconds: latency, target: 150 })
    );
    await main
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .click();
    await search.waitFor();
    expect(await search.inputValue()).toBe("");
    await launcher.getByRole("button", { name: /^Variable example/u }).click();
    expect(await name.inputValue()).toBe("");
    await name.fill("word");
    const identity = desktopStatusSchema.parse(
      await main.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("auth_status", {})
      )
    );
    const before = localPromptSchema.parse(
      await main.evaluate(
        (id) => window.__TAURI_INTERNALS__.invoke("library_editor", { id }),
        promptId
      )
    );
    await main.evaluate(
      (request) =>
        window.__TAURI_INTERNALS__.invoke("library_edit", { request }),
      {
        instanceId: identity.instanceId,
        accountId: identity.accountId,
        generation: identity.generation,
        operationId: crypto.randomUUID(),
        promptId,
        expectedLocalRevision: before.localRevision,
        desired: {
          title: "Variable example",
          description: "",
          content: "{{name|number}} {{new}}",
        },
      }
    );
    await launcher
      .getByRole("button", { name: "Restart with updated template" })
      .click();
    expect(
      await launcher.getByLabel("name (number)", { exact: true }).inputValue()
    ).toBe("word");
    expect(
      await launcher.getByLabel("new (string)", { exact: true }).inputValue()
    ).toBe("");
    await launcher.getByText("Enter decimal text", { exact: false }).waitFor();
    await launcher.getByRole("button", { name: "Back", exact: true }).click();
    await launcher
      .getByRole("button", { name: "Copy selected prompt", exact: true })
      .click();
    await launcher.getByLabel("name (number)", { exact: true }).fill("123");
    const updated = localPromptSchema.parse(
      await main.evaluate(
        (id) => window.__TAURI_INTERNALS__.invoke("library_editor", { id }),
        promptId
      )
    );
    await main.evaluate(
      (request) =>
        window.__TAURI_INTERNALS__.invoke("library_lifecycle", { request }),
      {
        instanceId: identity.instanceId,
        accountId: identity.accountId,
        generation: identity.generation,
        operationId: crypto.randomUUID(),
        promptId,
        expectedLocalRevision: updated.localRevision,
        action: { kind: "archive", value: true },
      }
    );
    await launcher.getByRole("dialog").waitFor({ state: "detached" });
    await search.press("Escape");
    await main
      .getByRole("navigation", { name: "Library views" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await main
      .getByRole("button", { name: "Copy Variable example", exact: true })
      .click();
    const libraryName = main.getByLabel("name (number)", { exact: true });
    expect(await libraryName.inputValue()).toBe("");
    await libraryName.fill("42");
    await main
      .getByLabel("new (string)", { exact: true })
      .fill("library value");
    await main.getByRole("button", { name: "Copy", exact: true }).click();
    await libraryName.waitFor({ state: "detached" });
    await main
      .getByRole("button", { name: "Copy Variable example", exact: true })
      .click();
    await libraryName.fill("private");
    await main.evaluate(
      (request) =>
        window.__TAURI_INTERNALS__.invoke("auth_sign_out", { request }),
      {
        instanceId: identity.instanceId,
        accountId: identity.accountId,
        generation: identity.generation,
        choice: "discard",
        discardConfirmed: true,
      }
    );
    await libraryName.waitFor({ state: "detached" });
  } finally {
    await releaseClipboard?.();
    await webview.stop();
    try {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    } catch {
      // WebView2 can retain its disposable profile after the owning process exits.
    }
  }
}, 60_000);

test("maximum output and a thousand variables remain keyboard accessible and meet the copy target", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "pr0-variable-performance-")
  );
  const native = await localNativeWorker(directory, true);
  const account = desktopStatusSchema.parse(
    await native.command("auth_status")
  );
  const names = Array.from({ length: 1000 }, (_, index) => `v${index}`);
  for (const { title, content } of [
    { title: "Maximum output", content: "{{value}}{{value}}" },
    {
      title: "Many variables",
      content: names.map((name) => `{{${name}}}`).join(""),
    },
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each native save is acknowledged before the next fixture.
    await native.command("library_create", {
      request: {
        instanceId: account.instanceId,
        accountId: account.accountId,
        generation: account.generation,
        operationId: crypto.randomUUID(),
        promptId: crypto.randomUUID(),
        expectedLocalRevision: null,
        desired: { title, content, description: "" },
      },
    });
  }
  await native.stop();
  const webview = await nativeWebview(native.executable, directory);
  try {
    const main = webview.page;
    await main
      .getByRole("button", { name: "Copy Maximum output", exact: true })
      .click();
    await main
      .getByLabel("value (string)", { exact: true })
      .fill("a".repeat(131_072));
    const maximumOutputMs = await measureCopy(main);
    await main
      .getByRole("button", { name: "Copy Many variables", exact: true })
      .click();
    for (const name of names) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Fill through actual controlled inputs, preserving React event semantics.
      await main.getByLabel(`${name} (string)`, { exact: true }).fill("x");
    }
    await main.getByLabel("v998 (string)", { exact: true }).focus();
    await main.keyboard.press("Tab");
    expect(
      await main
        .getByLabel("v999 (string)", { exact: true })
        .evaluate((element) => element === document.activeElement)
    ).toBe(true);
    const manyVariablesMs = await measureCopy(main);
    await Bun.write(
      ".scratch/desktop-variable-bound-latency.json",
      JSON.stringify({
        maximumOutputMs,
        outputBytes: 262_144,
        manyVariablesMs,
        fields: 1000,
        target: 150,
      })
    );
    expect(maximumOutputMs).toBeLessThanOrEqual(150);
    expect(manyVariablesMs).toBeLessThanOrEqual(150);
  } finally {
    await webview.stop();
    try {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    } catch {
      /* WebView2 may retain the disposable profile briefly after exit. */
    }
  }
}, 120_000);
