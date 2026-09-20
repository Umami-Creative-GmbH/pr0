import { expect, test } from "bun:test";

import { chromium } from "playwright";

import fixture from "../../../packages/api-contract/src/snapshot-fixtures.json";

test("partial desktop download remains browsable with honest offline progress and keyboard detail", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(({ manifest, pages }) => {
      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        value: { unregisterListener: () => {} },
      });
      let downloaded = 0;
      const [prompt] = JSON.parse(pages[0]?.payload ?? "{}").prompts;
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          transformCallback: () => 1,
          invoke: (command: string) => {
            if (command.startsWith("plugin:event|")) {
              return Promise.resolve(1);
            }
            if (command === "auth_status") {
              return Promise.resolve({
                state: "signed_in",
                generation: 1,
                origin: "https://instance.example",
                email: "fixture@example.test",
                accountId: manifest.accountId,
                instanceId: manifest.instanceId,
                userCode: null,
                message: "",
                pollAfterMs: 0,
              });
            }
            if (command === "library_download") {
              if (downloaded) {
                // oxlint-disable-next-line eslint/prefer-promise-reject-errors -- Tauri command rejections serialize Rust error codes as strings.
                return Promise.reject("network_unavailable");
              }
              downloaded = 1;
            }
            if (
              command === "library_status" ||
              command === "library_download"
            ) {
              return Promise.resolve({
                complete: false,
                pendingChanges: 0,
                textBytes: 0,
                downloaded,
                total: 2,
                appliedPages: downloaded,
                totalPages: 2,
                revision: "2",
                instanceId: manifest.instanceId,
                accountId: manifest.accountId,
              });
            }
            if (command === "library_browse") {
              return Promise.resolve(
                downloaded
                  ? [{ id: prompt.id, title: prompt.title, archived: false }]
                  : []
              );
            }
            if (command === "library_detail") {
              return Promise.resolve(prompt);
            }
            if (command === "library_editor") {
              return Promise.resolve({
                prompt,
                localRevision: "0",
                pending: false,
              });
            }
            return Promise.reject(new Error("unexpected_command"));
          },
        },
      });
    }, fixture);
    await page.goto("http://localhost:1420");
    await page
      .getByText("Offline. Download paused", { exact: false })
      .waitFor();
    expect(
      await page
        .getByText("The offline library is incomplete.", { exact: false })
        .count()
    ).toBe(1);
    const first = page.getByRole("button", { name: "First", exact: true });
    await first.focus();
    await page.keyboard.press("Enter");
    expect(await page.getByLabel("Prompt content").inputValue()).toBe(
      "  Hello offline\n"
    );
    expect(await page.getByRole("progressbar").getAttribute("value")).toBe("1");
    await page.screenshot({
      path: ".scratch/issue40-partial-offline.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
});
