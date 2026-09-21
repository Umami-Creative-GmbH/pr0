import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { residentStatusSchema } from "@pr0/api-contract/desktop-resident";

import { localNativeWorker } from "./local-native-worker";
import { nativeWebview } from "./native-webview";

test("resident quit cancels without losing a draft and saves offline before restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-resident-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory);
  try {
    const { page } = view;
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Resident draft");
    await page
      .getByLabel("Content", { exact: true })
      .fill("Preserved offline content");
    await page.getByRole("button", { name: "Quit pr0", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Quit pr0", exact: true })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(await page.getByLabel("Content", { exact: true }).inputValue()).toBe(
      "Preserved offline content"
    );
    await page.getByRole("button", { name: "Quit pr0", exact: true }).click();
    await page
      .getByRole("button", { name: "Save and quit", exact: true })
      .click();
    expect(await view.exited).toBe(0);
  } finally {
    await view.stop();
  }
  const restarted = await nativeWebview(native.executable, directory);
  try {
    await restarted.page
      .getByRole("heading", { name: "Resident draft", exact: true })
      .waitFor();
    await restarted.page
      .getByRole("button", { name: "Quit pr0", exact: true })
      .click();
    expect(await restarted.exited).toBe(0);
  } finally {
    await restarted.stop();
  }
}, 60_000);

test("tray-style quit waits for an in-progress local save without a network acknowledgement", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-resident-saving-"));
  const control = path.join(directory, "save-control");
  await writeFile(control, "wait");
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory, {
    PR0_RESIDENT_SAVE_CONTROL: control,
  });
  try {
    const { page } = view;
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("In-flight quit");
    await page
      .getByLabel("Content", { exact: true })
      .fill("Wait for the commit");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saving…", { exact: true }).waitFor();
    await page.evaluate(async () => {
      await window.__TAURI_INTERNALS__.invoke("resident_action", {
        action: "quit",
      });
    });
    await page
      .getByText("Waiting for the local save…", { exact: true })
      .waitFor();
    const status = residentStatusSchema.parse(
      await page.evaluate(
        async () =>
          await window.__TAURI_INTERNALS__.invoke("resident_status", {})
      )
    );
    expect(status.saving).toBe(1);
    expect(
      await page
        .getByRole("button", { name: "Discard and quit", exact: true })
        .isDisabled()
    ).toBe(true);
    await writeFile(control, "");
    expect(await view.exited).toBe(0);
  } finally {
    await writeFile(control, "");
    await view.stop();
  }
  const restarted = await nativeWebview(native.executable, directory);
  try {
    await restarted.page
      .getByRole("heading", { name: "In-flight quit", exact: true })
      .waitFor();
    await restarted.page
      .getByRole("button", { name: "Quit pr0", exact: true })
      .click();
    expect(await restarted.exited).toBe(0);
  } finally {
    await restarted.stop();
  }
}, 60_000);

test("library close explains residency and repeated manual activation restores the existing draft", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-resident-close-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory, {
    PR0_TEST_CLOSE_MAIN: "true",
  });
  try {
    const { page } = view;
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Retained resident draft");
    await page
      .getByLabel("Content", { exact: true })
      .fill("Memory only until saved");
    await page.getByRole("dialog", { name: "Keep pr0 running" }).waitFor();
    await page
      .getByRole("button", { name: "Hide library", exact: true })
      .click();
    const launches = Array.from({ length: 4 }, () =>
      Bun.spawn(
        [
          native.executable,
          "--exact",
          "auth_tests::desktop_search_webview_worker",
          "--nocapture",
        ],
        {
          env: { ...process.env, PR0_SEARCH_WEBVIEW_DIRECTORY: directory },
          stdout: "ignore",
          stderr: "inherit",
        }
      )
    );
    expect(await Promise.all(launches.map((child) => child.exited))).toEqual([
      0, 0, 0, 0,
    ]);
    expect(await page.getByLabel("Content", { exact: true }).inputValue()).toBe(
      "Memory only until saved"
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByText("pr0 is still running in the notification area.", {
        exact: false,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Close Settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Quit pr0", exact: true }).click();
    await page.screenshot({ path: "docs/evidence/issue-54-resident-quit.png" });
    await page
      .getByRole("button", { name: "Discard and quit", exact: true })
      .click();
    expect(await view.exited).toBe(0);
  } finally {
    await view.stop();
  }
}, 60_000);

test("failed Save and quit retains the complete draft and permits recovery", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-resident-failure-"));
  const control = path.join(directory, "save-control");
  await writeFile(control, "disk_full");
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory, {
    PR0_RESIDENT_SAVE_CONTROL: control,
  });
  try {
    const { page } = view;
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Failed quit");
    const content = "x".repeat(262_144);
    await page.getByLabel("Content", { exact: true }).fill(content);
    await page.getByRole("button", { name: "Quit pr0", exact: true }).click();
    await page
      .getByRole("button", { name: "Save and quit", exact: true })
      .click();
    await page.getByText("Not saved", { exact: true }).waitFor();
    expect(await page.getByLabel("Content", { exact: true }).inputValue()).toBe(
      content
    );
    await page
      .getByRole("button", { name: "Copy text", exact: true })
      .waitFor();
    await writeFile(control, "");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page
      .getByRole("button", { name: "Failed quit", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Quit pr0", exact: true }).click();
    expect(await view.exited).toBe(0);
  } finally {
    await view.stop();
  }
}, 60_000);
