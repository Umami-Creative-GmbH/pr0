// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- UI steps follow durable native commits.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { localOrganizationSchema } from "@pr0/api-contract/local-organization";
import { chromium } from "playwright";

import { connect } from "./local-native-ui";
import { localNativeWorker } from "./local-native-worker";

test("full native organization pickers stay searchable at 200 collections and 1000 tags in a 200 percent zoom equivalent viewport", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pr0-org-capacity-ui-")
  );
  const native = await localNativeWorker(directory, false, true);
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 2,
    });
    await connect(page, native, () => "");
    await page
      .getByRole("button", { name: "Manage tags", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search tags", { exact: true }).fill("Tag 0999");
    await dialog
      .getByRole("button", { name: "Rename Tag 0999", exact: true })
      .waitFor();
    expect(
      await dialog
        .getByRole("list", { name: "Tags", exact: true })
        .getByRole("listitem")
        .count()
    ).toBe(1);
    await dialog.getByRole("tab", { name: "Collections", exact: true }).click();
    await dialog
      .getByLabel("Search collections", { exact: true })
      .fill("Collection 0199");
    await dialog
      .getByRole("button", { name: "Rename Collection 0199", exact: true })
      .waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.screenshot({ path: ".scratch/issue45-capacity-zoom.png" });
    await page.keyboard.press("Enter");
    await page
      .getByLabel("Search tag filters", { exact: true })
      .fill("Tag 0999");
    await page
      .getByRole("region", { name: "Collections and tags", exact: true })
      .getByRole("checkbox", { name: /Tag 0999/u })
      .check();
    await page
      .getByRole("button", { name: "Remove tag Tag 0999", exact: true })
      .waitFor();
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("native organization dialog keeps invalid drafts editable and persists explicit merge review across restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-org-ui-"));
  let native = await localNativeWorker(directory);
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "chrome",
    headless: true,
  });
  try {
    let page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await connect(page, native, () => "");
    page.on("pageerror", (error) => process.stderr.write(`${error.message}\n`));
    await page
      .getByRole("button", { name: "Manage tags", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Tag name", { exact: true }).fill("x".repeat(61));
    await dialog
      .getByRole("button", { name: "Create tag", exact: true })
      .click();
    expect(
      await dialog
        .getByLabel("Tag name", { exact: true })
        .getAttribute("readonly")
    ).toBeNull();
    for (const name of ["Draft", "Writing"]) {
      await dialog.getByLabel("Tag name", { exact: true }).fill(name);
      await dialog
        .getByRole("button", { name: "Create tag", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: `Rename ${name}`, exact: true })
        .waitFor();
    }
    await dialog
      .getByRole("button", { name: "Rename Draft", exact: true })
      .click();
    await dialog.getByLabel("Tag name", { exact: true }).fill("writing");
    await dialog
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Merge into Writing", exact: true })
      .waitFor();
    expect(
      localOrganizationSchema.parse(
        await native.command("library_organization")
      ).tags
    ).toHaveLength(2);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Merge into Writing", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Review affected prompts", exact: true })
      .click();
    await dialog
      .getByText(
        "Original affected identities; current state is shown. Later changes are separate from this operation."
      )
      .waitFor();
    await page.screenshot({
      path: ".scratch/issue45-native-review.png",
      fullPage: true,
    });
    const saved = localOrganizationSchema.parse(
      await native.command("library_organization")
    );
    expect(saved.tags).toHaveLength(1);
    expect(saved.effects).toHaveLength(1);
    await page.close();
    await native.stop();
    native = await localNativeWorker(directory);
    page = await browser.newPage();
    await connect(page, native, () => "");
    await page
      .getByRole("button", { name: "Manage tags", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Review Draft · Saved on this device",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Review affected prompts", exact: true })
      .waitFor();
    expect(
      localOrganizationSchema.parse(
        await native.command("library_organization")
      ).states[0]?.state
    ).toBe("merged");
  } finally {
    await browser.close();
    await native.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
