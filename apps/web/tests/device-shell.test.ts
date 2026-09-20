// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Wait for the actual WebView2 debugging endpoint to become ready.
import { expect, test } from "bun:test";
import path from "node:path";

import { chromium } from "playwright";

test("built Tauri shell exposes only account commands and denies remote native access", async () => {
  const executable = path.resolve(
    "apps/desktop/src-tauri/target/debug/pr0-desktop.exe"
  );
  const app = Bun.spawn([executable], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=19239",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const remote = Bun.serve({
    hostname: "127.0.0.1",
    port: 19_240,
    fetch: () =>
      new Response("<!doctype html><title>Untrusted test page</title>", {
        headers: { "Content-Type": "text/html" },
      }),
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch("http://127.0.0.1:19239/json/version");
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* WebView2 is still starting. */
      }
      await Bun.sleep(500);
    }
    expect(ready).toBe(true);
    const browser = await chromium.connectOverCDP("http://127.0.0.1:19239");
    try {
      const page = browser.contexts()[0]?.pages()[0];
      expect(page).toBeDefined();
      if (!page) {
        throw new Error("Native shell did not create its main window");
      }
      await page.getByRole("heading", { name: "pr0", exact: true }).waitFor();
      const status = await page.evaluate(
        "window.__TAURI_INTERNALS__.invoke('auth_status')"
      );
      expect(JSON.stringify(status)).not.toContain('"token"');
      const denied = await page.evaluate(
        "window.__TAURI_INTERNALS__.invoke('relay', {event:'test',payload:{}}).then(() => false, () => true)"
      );
      expect(denied).toBe(true);
      const noHttp = await page.evaluate(
        "window.__TAURI_INTERNALS__.invoke('auth_begin', {origin:'http://example.com'}).then(() => false, error => error === 'invalid_instance')"
      );
      expect(noHttp).toBe(true);
      await page.screenshot({ path: ".scratch/issue39-shell.png" });
      await page.goto("http://127.0.0.1:19240/");
      const remoteDenied = await page.evaluate(
        "window.__TAURI_INTERNALS__ ? window.__TAURI_INTERNALS__.invoke('auth_status').then(() => false, () => true) : true"
      );
      expect(remoteDenied).toBe(true);
    } finally {
      await browser.close();
    }
  } finally {
    app.kill();
    await app.exited;
    await remote.stop(true);
  }
});
