import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { localNativeWorker } from "./local-native-worker";
import { nativeWebview } from "./native-webview";

test("an unconfigured build explains update availability and rejects installation without quitting", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-update-ui-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory);
  try {
    await view.page
      .getByRole("region", { name: "Application updates" })
      .getByText("This build has no update signing configuration.", {
        exact: false,
      })
      .waitFor();
    expect(
      await view.page
        .getByRole("button", {
          name: "Install update and restart",
          exact: true,
        })
        .count()
    ).toBe(0);
    const rejection = await view.page.evaluate(async () => {
      try {
        await window.__TAURI_INTERNALS__.invoke("update_request_install", {});
        return "installed";
      } catch (error) {
        return String(error);
      }
    });
    expect(rejection).toBe("update_not_verified");
    await view.page
      .getByRole("button", { name: "New prompt", exact: true })
      .click();
    await view.page
      .getByLabel("Title", { exact: true })
      .fill("Still editable after update rejection");
    expect(
      await view.page.getByLabel("Title", { exact: true }).inputValue()
    ).toBe("Still editable after update rejection");
  } finally {
    await view.stop();
  }
}, 60_000);
