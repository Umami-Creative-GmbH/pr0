// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Signed-in opens and cross-device changes are measured as complete sequential journeys.
import assert from "node:assert/strict";

import {
  mutationResponseSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";

import { capacityId } from "./capacity-corpus";
import { capacityP95 } from "./capacity-statistics";
import type { SelfHostingInstance } from "./self-hosting-fixture";

const benchmarkPage = async (context: BrowserContext) => {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 50,
    downloadThroughput: 2_500_000,
    uploadThroughput: 2_500_000,
  });
  page.setDefaultTimeout(30_000);
  return page;
};
const painted = async (page: Page) =>
  await page.evaluate(async () => {
    const done = Promise.withResolvers<undefined>();
    requestAnimationFrame(() => requestAnimationFrame(() => done.resolve()));
    await done.promise;
  });

export const measureCapacityWeb = async (
  instance: SelfHostingInstance,
  cookie: string
) => {
  const browser = await chromium.launch({
    channel: process.env.PR0_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  });
  const opens: number[] = [];
  const crossDevice: number[] = [];
  let failure = "";
  try {
    const context = await browser.newContext({ locale: "en-US" });
    await context.addCookies(
      cookie.split("; ").map((value) => {
        const split = value.indexOf("=");
        return {
          name: value.slice(0, split),
          value: value.slice(split + 1),
          url: instance.origin,
        };
      })
    );
    for (let sample = 0; sample < 20; sample += 1) {
      const page = await benchmarkPage(context);
      const started = performance.now();
      await page.goto(instance.origin);
      await page.getByRole("searchbox", { name: "Search prompts" }).waitFor();
      await page.getByRole("button", { name: /^Prompt 00001 Café/u }).waitFor();
      await painted(page);
      opens.push(performance.now() - started);
      await page.close();
    }
    // Keep separate journey groups within the ordinary authenticated request budget.
    await Bun.sleep(60_000);
    const writer = await benchmarkPage(context);
    const viewer = await benchmarkPage(context);
    await writer.goto(instance.origin);
    await viewer.goto(instance.origin);
    await viewer
      .getByRole("heading", { name: "Prompt 00001 Café", exact: true })
      .waitFor();
    const library = await instance.library(cookie);
    const detail = await instance.request(
      `/api/v1/library/prompts/${capacityId(1)}`,
      undefined,
      cookie
    );
    assert.equal(detail.status, 200);
    const prompt = promptSchema.parse(await detail.json());
    for (let sample = 0; sample < 20; sample += 1) {
      const title = `${sample % 2 === 0 ? "p" : "P"}${prompt.title.slice(1)}`;
      const operationId = crypto.randomUUID();
      const envelope = {
        protocolVersion: 1,
        instanceId: library.instance.id,
        accountId: library.account.id,
        epoch: library.epoch,
        installationId: crypto.randomUUID(),
        operations: [
          {
            kind: "prompt.update",
            operationId,
            promptId: prompt.id,
            baseRevision: prompt.revision,
            dependsOn: [],
            changedFields: ["title"],
            base: {
              title: prompt.title,
              description: prompt.description,
              content: prompt.content,
            },
            desired: {
              title,
              description: prompt.description,
              content: prompt.content,
            },
          },
        ],
      };
      const started = performance.now();
      const result = await writer.evaluate(async (body) => {
        const response = await fetch("/api/v1/sync/mutations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        return { status: response.status, body: await response.text() };
      }, JSON.stringify(envelope));
      assert.equal(result.status, 200);
      const [receipt] = mutationResponseSchema.parse(
        JSON.parse(result.body)
      ).results;
      assert.ok(
        receipt?.status === "accepted" && receipt.operationId === operationId
      );
      await viewer.getByRole("heading", { name: title, exact: true }).waitFor();
      await painted(viewer);
      crossDevice.push(performance.now() - started);
      assert.ok("promptId" in receipt);
      prompt.title = title;
      prompt.revision = receipt.revision;
    }
  } catch (error) {
    failure = String(error);
    throw error;
  } finally {
    await Bun.write(
      "docs/evidence/issue-65-web.json",
      `${JSON.stringify({ recordedAt: new Date().toISOString(), browser: browser.version(), network: { latencyMs: 50, bitsPerSecond: 20_000_000, scope: "CDP per-page shaping; public REST and live web UI on shared host; shared browser session represents two online browser devices" }, opens, crossDevice, openP95Ms: opens.length ? capacityP95(opens) : null, crossDeviceP95Ms: crossDevice.length ? capacityP95(crossDevice) : null, failure, passed: !failure && opens.length === 20 && crossDevice.length === 20 && capacityP95(opens) <= 2000 && capacityP95(crossDevice) <= 5000 }, null, 2)}\n`
    );
    await browser.close();
  }
};
