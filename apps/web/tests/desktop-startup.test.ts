import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chooseAccountAction } from "./app-menus";
import { localNativeWorker } from "./local-native-worker";
import { nativeWebview } from "./native-webview";
import { startupRegistry } from "./startup-registry";

test("first run offers startup off once and Settings retains its control after restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-startup-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory, {
    PR0_TEST_STARTUP: "true",
  });
  try {
    const offer = view.page.getByRole("region", { name: "Start at login" });
    await offer.waitFor();
    await offer.getByText("Off", { exact: true }).waitFor();
    await offer.getByRole("button", { name: "Not now", exact: true }).click();
    await offer.waitFor({ state: "detached" });
    await chooseAccountAction(view.page, "Quit pr0");
    expect(await view.exited).toBe(0);
  } finally {
    await view.stop();
  }
  const restarted = await nativeWebview(native.executable, directory, {
    PR0_TEST_STARTUP: "true",
  });
  try {
    await restarted.page
      .getByRole("button", { name: "New prompt", exact: true })
      .waitFor();
    await chooseAccountAction(restarted.page, "Settings");
    const settings = restarted.page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings.getByText("Off", { exact: true }).waitFor();
    await settings
      .getByRole("button", { name: "Enable Start at login", exact: true })
      .click();
    await settings.getByText("On", { exact: true }).waitFor();
    await settings
      .getByRole("button", { name: "Disable Start at login", exact: true })
      .click();
    await settings.getByText("Off", { exact: true }).waitFor();
    await settings
      .getByRole("button", { name: "Close Settings", exact: true })
      .click();
    await settings.waitFor({ state: "detached" });
    expect(
      await restarted.page
        .getByRole("region", { name: "Start at login" })
        .count()
    ).toBe(0);
    await chooseAccountAction(restarted.page, "Quit pr0");
    expect(await restarted.exited).toBe(0);
  } finally {
    await restarted.stop();
    await startupRegistry(directory, "cleanup");
  }
}, 60_000);

test("quit preserves registration and manual restart respects Windows disablement", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-startup-external-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory);
  try {
    await view.page
      .getByRole("button", { name: "New prompt", exact: true })
      .waitFor();
    await chooseAccountAction(view.page, "Settings");
    await view.page
      .getByRole("button", { name: "Enable Start at login", exact: true })
      .click();
    await view.page.getByText("On", { exact: true }).waitFor();
    await view.page
      .getByRole("button", { name: "Close Settings", exact: true })
      .click();
    await view.page
      .getByRole("dialog", { name: "Settings", exact: true })
      .waitFor({ state: "detached" });
    await chooseAccountAction(view.page, "Quit pr0");
    expect(await view.exited).toBe(0);
  } finally {
    await view.stop();
  }
  const restarted = await nativeWebview(native.executable, directory);
  try {
    await restarted.page
      .getByRole("button", { name: "New prompt", exact: true })
      .waitFor();
    await chooseAccountAction(restarted.page, "Settings");
    await restarted.page.getByText("On", { exact: true }).waitFor();
    await startupRegistry(directory, "disable");
    await restarted.page
      .getByRole("button", { name: "Check again", exact: true })
      .click();
    await restarted.page
      .getByText("Disabled by Windows.", { exact: false })
      .waitFor();
    await restarted.page
      .getByRole("button", { name: "Enable Start at login", exact: true })
      .click();
    await restarted.page
      .getByRole("alert")
      .getByText("Windows has disabled this startup entry.", { exact: false })
      .waitFor();
    await restarted.page
      .getByRole("button", { name: "Close Settings", exact: true })
      .click();
    await restarted.page
      .getByRole("dialog", { name: "Settings", exact: true })
      .waitFor({ state: "detached" });
    await chooseAccountAction(restarted.page, "Quit pr0");
    expect(await restarted.exited).toBe(0);
  } finally {
    await restarted.stop();
  }
  const disabled = await nativeWebview(native.executable, directory);
  try {
    await disabled.page
      .getByRole("button", { name: "New prompt", exact: true })
      .waitFor();
    await chooseAccountAction(disabled.page, "Settings");
    await disabled.page
      .getByText("Disabled by Windows.", { exact: false })
      .waitFor();
    await startupRegistry(directory, "unknown");
    await disabled.page
      .getByRole("button", { name: "Check again", exact: true })
      .click();
    await disabled.page
      .getByText("Windows startup state could not be verified.", {
        exact: true,
      })
      .waitFor();
    await disabled.page.screenshot({
      path: "docs/evidence/issue-55-startup-state.png",
    });
  } finally {
    await disabled.stop();
    await startupRegistry(directory, "cleanup");
  }
}, 60_000);

test("Windows registration failure stays an error and does not claim startup enabled", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-startup-failure-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory, {
    PR0_TEST_STARTUP_DENY_WRITE: "true",
  });
  try {
    await view.page
      .getByRole("button", { name: "New prompt", exact: true })
      .waitFor();
    await chooseAccountAction(view.page, "Settings");
    await view.page
      .getByRole("button", { name: "Enable Start at login", exact: true })
      .click();
    await view.page
      .getByRole("alert")
      .getByText("Could not confirm the startup change.", { exact: false })
      .waitFor();
    await view.page.getByText("Off", { exact: true }).waitFor();
    await view.page
      .getByRole("button", { name: "Check again", exact: true })
      .click();
    expect(await view.page.getByRole("alert").count()).toBe(1);
    expect(await view.page.getByText("On", { exact: true }).count()).toBe(0);
  } finally {
    await view.stop();
    await startupRegistry(directory, "cleanup");
  }
}, 60_000);

test("login launch stays hidden and a racing manual launch activates the one resident library", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-startup-race-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory, {
    PR0_TEST_STARTUP_LAUNCH: "true",
  });
  try {
    await view.page
      .getByRole("heading", { name: "Your personal prompt library" })
      .waitFor({ state: "attached" });
    expect(
      await view.page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("surface_visible", {})
      )
    ).toBe(false);
    const launcher = view.browser
      .contexts()[0]
      ?.pages()
      .find((page) => page.url().includes("launcher.html"));
    if (!launcher) {
      throw new Error("Missing native launcher surface");
    }
    expect(
      await launcher.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("surface_visible", {})
      )
    ).toBe(false);
    expect(
      await launcher.evaluate(async () => {
        try {
          await window.__TAURI_INTERNALS__.invoke("startup_action", {
            action: "enable",
          });
          return "allowed";
        } catch {
          return "denied";
        }
      })
    ).toBe("denied");
    const launch = (quiet: boolean) =>
      Bun.spawn(
        [
          native.executable,
          "--exact",
          "auth_tests::desktop_search_webview_worker",
          "--nocapture",
        ],
        {
          env: {
            ...process.env,
            PR0_SEARCH_WEBVIEW_DIRECTORY: directory,
            PR0_TEST_STARTUP_LAUNCH: String(quiet),
          },
          stdout: "ignore",
          stderr: "inherit",
        }
      );
    expect(await launch(true).exited).toBe(0);
    expect(
      await view.page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("surface_visible", {})
      )
    ).toBe(false);
    expect(
      await Promise.all([launch(false).exited, launch(true).exited])
    ).toEqual([0, 0]);
    await view.page.waitForFunction(
      async () => await window.__TAURI_INTERNALS__.invoke("surface_visible", {})
    );
    await chooseAccountAction(view.page, "Quit pr0");
    expect(await view.exited).toBe(0);
  } finally {
    await view.stop();
  }
}, 60_000);

test("hidden presentation clocks stop and library opening from the launcher refreshes them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-startup-clock-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory);
  try {
    await view.page.clock.install();
    await view.page
      .getByRole("button", { name: "New prompt", exact: true })
      .click();
    await view.page.getByLabel("Title", { exact: true }).fill("Clock prompt");
    await view.page
      .getByLabel("Content", { exact: true })
      .fill("Clock presentation fixture");
    await view.page.getByRole("button", { name: "Save", exact: true }).click();
    const time = view.page
      .locator("time")
      .filter({ hasText: "just now" })
      .first();
    await time.waitFor();
    const at = await time.getAttribute("datetime");
    const timestamp = view.page.locator(`time[datetime="${at}"]`).first();
    await view.page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("resident_hide", {})
    );
    await view.page
      .locator('html[data-surface-hidden="true"]')
      .waitFor({ state: "attached" });
    await view.page.clock.fastForward(125_000);
    expect(await timestamp.textContent()).toBe("just now");
    const launcher = view.browser
      .contexts()[0]
      ?.pages()
      .find((page) => page.url().includes("launcher.html"));
    if (!launcher) {
      throw new Error("Missing native launcher surface");
    }
    await launcher.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("launcher_library_details", {})
    );
    await view.page
      .locator('html[data-surface-hidden="false"]')
      .waitFor({ state: "attached" });
    await view.page.clock.runFor(100);
    expect(await timestamp.textContent()).toBe("2 min ago");
  } finally {
    await view.stop();
  }
}, 60_000);
