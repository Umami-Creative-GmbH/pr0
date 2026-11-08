// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each sample follows a completed clipboard or durable-save acknowledgement.
import assert from "node:assert/strict";

import type { Page } from "playwright";

import { capacityP95 } from "./capacity-statistics";

const finalDialogAction = async (page: Page, label: string) =>
  await page.evaluate(async (text) => {
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
    const button = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (item) => item.textContent?.trim() === text
    );
    if (!dialog || !button || button.disabled) {
      throw new Error("Final action is unavailable");
    }
    const completed = Promise.withResolvers<undefined>();
    const observer = new MutationObserver(() => {
      if (!dialog.isConnected || !dialog.open) {
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => completed.resolve())
        );
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    const timeout = setTimeout(
      () =>
        completed.reject(
          new Error(
            `Final action did not acknowledge success: ${dialog.textContent?.slice(-1200)}`
          )
        ),
      30_000
    );
    const started = performance.now();
    button.click();
    try {
      await completed.promise;
      return performance.now() - started;
    } finally {
      clearTimeout(timeout);
      observer.disconnect();
    }
  }, label);

export const measureDesktopInteractions = async (
  page: Page,
  onProgress?: (samples: {
    launcher: number[];
    copy: number[];
    save: number[];
  }) => void
) => {
  const launcherPage = page
    .context()
    .pages()
    .find((entry) => entry.url().includes("launcher.html"));
  assert.ok(launcherPage, "Production launcher window is missing");
  const launcher: number[] = [];
  const copy: number[] = [];
  const save: number[] = [];
  onProgress?.({ launcher, copy, save });
  for (let sample = 0; sample < 20; sample += 1) {
    const started = performance.now();
    await page
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .click();
    await launcherPage.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[type="search"]'
      );
      return (
        document.hasFocus() &&
        document.activeElement === input &&
        input !== null &&
        !input.disabled
      );
    });
    launcher.push(performance.now() - started);
    await launcherPage
      .getByRole("searchbox", { name: "Search prompts", exact: true })
      .press("Escape");
  }
  const search = page.getByRole("searchbox", {
    name: "Search downloaded prompts",
  });
  await search.fill("Prompt 00001");
  await page.locator('[data-search-query="Prompt 00001"]').waitFor();
  await page.getByRole("button", { name: /^Prompt 00001 Café/u }).click();
  for (let sample = 0; sample < 20; sample += 1) {
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await page.getByLabel("name (string)", { exact: true }).fill("Ada");
    copy.push(await finalDialogAction(page, "Copy"));
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    const content = page
      .getByRole("dialog")
      .getByLabel("Content", { exact: true });
    const previous = await content.inputValue();
    assert.ok(previous.startsWith("write") || previous.startsWith("Write"));
    await content.fill((sample % 2 === 0 ? "W" : "w") + previous.slice(1));
    save.push(await finalDialogAction(page, "Save"));
    await page
      .getByText("Saved on this device", { exact: true })
      .first()
      .waitFor();
  }
  copy.sort((a, b) => a - b);
  save.sort((a, b) => a - b);
  return {
    launcher: { samples: launcher, p95Ms: capacityP95(launcher) },
    copy: { samples: copy, p95Ms: capacityP95(copy) },
    save: { samples: save, p95Ms: capacityP95(save) },
  };
};
