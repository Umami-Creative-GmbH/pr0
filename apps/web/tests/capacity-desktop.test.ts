// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Native acknowledgements and measured user interactions must remain sequential.
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { cpus, tmpdir, totalmem } from "node:os";
import path from "node:path";

import { desktopSearchPageSchema } from "@pr0/api-contract/desktop-search";
import { desktopStatusSchema } from "@pr0/api-contract/desktop-session";
import { downloadStatusSchema } from "@pr0/api-contract/snapshots";
import type { Page } from "playwright";
import { z } from "zod";

import {
  capacityBytes,
  capacityCount,
  capacityPhrase,
  capacityId,
} from "./capacity-corpus";
import {
  measureDesktopInteractions,
  prepareDesktopResidency,
} from "./capacity-desktop-interactions";
import { profileDesktopPhase } from "./capacity-desktop-profile";
import type { ProfilePhase } from "./capacity-desktop-profile";
import { capacityIdentity, writeCapacitySnapshot } from "./capacity-snapshot";
import { capacityP95 } from "./capacity-statistics";
import { localNativeWorker } from "./local-native-worker";
import { nativeWebview } from "./native-webview";

const measureSearch = async (page: Page, query: string) => {
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="search"]:not(details input)'
    );
    if (!input) {
      throw new Error("Missing production search field");
    }
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator('[data-search-query=""]').waitFor();
  return await page.evaluate(async (value) => {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="search"]:not(details input)'
    );
    if (!input) {
      throw new Error("Missing production search field");
    }
    const completed = Promise.withResolvers<undefined>();
    const observer = new MutationObserver(() => {
      if (
        document.querySelector<HTMLElement>("[data-search-query]")?.dataset
          .searchQuery === value
      ) {
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => completed.resolve())
        );
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      completed.reject(new Error("Search render timeout"));
    }, 30_000);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
    });
    const start = performance.now();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      await completed.promise;
      return performance.now() - start;
    } finally {
      clearTimeout(timeout);
      observer.disconnect();
    }
  }, query);
};

const expectedQueryCount = (query: string) => {
  if (query === "abcdbcdabc") {
    return 0;
  }
  // Every body contains abc and bcd, while seven noisy bodies contain abcd.
  return query === "abcd" ? 7 : 50;
};

const completeNativeSearch = async (page: Page, generation: number) => {
  const request = {
    ...capacityIdentity,
    generation,
    query: "cafe resume common equipe reponses",
    limit: 100,
    view: "all",
    sort: "relevance",
    tagIds: [],
  };
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const pagedRequest: typeof request & {
      requestId: string;
      cursor?: string;
    } = {
      ...request,
      requestId: crypto.randomUUID(),
    };
    if (cursor) {
      pagedRequest.cursor = cursor;
    }
    const result = desktopSearchPageSchema.parse(
      await page.evaluate(
        (args) =>
          window.__TAURI_INTERNALS__.invoke("library_search", {
            request: args,
          }),
        pagedRequest
      )
    );
    for (const prompt of result.prompts) {
      if (ids.has(prompt.id)) {
        throw new Error("Native pagination returned a duplicate prompt");
      }
      ids.add(prompt.id);
    }
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return ids;
};

interface DesktopCapacityEvidence {
  recordedAt: string;
  bun: string;
  cpu: string | undefined;
  logicalCpus: number;
  memoryBytes: number;
  promptCount: number;
  textBytes: number;
  tags: number;
  collections: number;
  tagsPerPrompt: number;
  classification: string;
  results: { query: string; samples: number[]; p95Ms: number }[];
  profile?: ProfilePhase[];
  automationDisconnectedBeforeResidency?: boolean;
  passed: boolean;
  releaseCriteriaMet: false;
  browserDefaultsPreserved: true;
  interactionProgress?: { launcher: number[]; copy: number[]; save: number[] };
  initialDownloadMs?: number;
  processColdUiMs?: number;
  webview?: string;
  completePaginationCount?: number;
  databaseBytes?: number;
  failure?: string;
  fixtureDirectory?: string;
  reused?: boolean;
  interactions?: Awaited<ReturnType<typeof measureDesktopInteractions>>;
  residencyState?: Awaited<ReturnType<typeof prepareDesktopResidency>>;
  residency?: {
    intervalMs: number;
    peakSampledPrivateBytes: number;
    meanCpuPercentOfMachine: number;
  };
}

test("maximum Unicode library preserves complete results after restart and records production UI latency", async () => {
  const reused = process.env.PR0_CAPACITY_REUSE_DIRECTORY;
  const directory =
    reused ?? (await mkdtemp(path.join(tmpdir(), "pr0-capacity-65-")));
  const fixture = await mkdtemp(
    path.join(tmpdir(), "pr0-capacity-snapshot-65-")
  );
  const previous = process.env.PR0_SEARCH_FIXTURE_DIRECTORY;
  const results: { query: string; samples: number[]; p95Ms: number }[] = [];
  const evidence: DesktopCapacityEvidence = {
    recordedAt: new Date().toISOString(),
    bun: Bun.version,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    promptCount: capacityCount,
    textBytes: capacityBytes,
    tags: 1000,
    collections: 200,
    tagsPerPrompt: 20,
    classification:
      "supporting evidence; account and snapshot transport fixtures; unrestricted host; offline test worker without production synchronization loops; online latency, bandwidth, installed-build and settled online residency gates are unmeasured",
    results,
    passed: false,
    releaseCriteriaMet: false,
    browserDefaultsPreserved: true,
    fixtureDirectory: directory,
    reused: Boolean(reused),
  };
  let native: Awaited<ReturnType<typeof localNativeWorker>> | undefined;
  let view: Awaited<ReturnType<typeof nativeWebview>> | undefined;
  try {
    await writeCapacitySnapshot(fixture);
    process.env.PR0_SEARCH_FIXTURE_DIRECTORY = fixture;
    const started = performance.now();
    native = await localNativeWorker(directory, true, false, false, "release");
    let status = downloadStatusSchema.parse(
      await native.command("library_status")
    );
    while (!status.complete) {
      expect(status.error).toBeNull();
      await native.command("library_download");
      status = downloadStatusSchema.parse(
        await native.command("library_status")
      );
    }
    if (!reused) {
      evidence.initialDownloadMs = performance.now() - started;
    }
    expect(status).toMatchObject({
      complete: true,
      downloaded: 10_000,
      textBytes: 104_857_600,
    });
    const { executable } = native;
    await native.stop();
    native = undefined;
    const cold = performance.now();
    view = await nativeWebview(executable, directory);
    await view.page.locator("[data-search-query]").waitFor();
    evidence.processColdUiMs = performance.now() - cold;
    evidence.webview = view.browser.version();
    let automationConnected = true;
    const profile = async (name: string) => {
      if (process.env.PR0_CAPACITY_PROFILE === "true" && view) {
        evidence.profile ??= [];
        evidence.profile.push(
          await profileDesktopPhase(view, name, cold, automationConnected)
        );
      }
    };
    await profile("initial-render");
    const queries = [
      "a",
      "C++",
      "common",
      "abcdbcdabc",
      "abcd",
      "cafe resume common equipe reponses",
      "Σίσυφος 東京",
      "🎯",
      capacityPhrase,
    ];
    for (const query of queries) {
      const samples = [];
      for (let sample = 0; sample < 20; sample += 1) {
        samples.push(await measureSearch(view.page, query));
        expect(
          await view.page
            .getByRole("list", { name: "Search results" })
            .getByRole("listitem")
            .count()
        ).toBe(expectedQueryCount(query));
      }
      samples.sort((a, b) => a - b);
      results.push({
        query,
        samples,
        p95Ms: capacityP95(samples),
      });
    }
    await profile("after-searches");
    const account = desktopStatusSchema.parse(
      await view.page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke("auth_status", {})
      )
    );
    const ids = await completeNativeSearch(view.page, account.generation);
    expect(ids.size).toBe(10_000);
    expect(ids.has(capacityId(10_000))).toBe(true);
    evidence.completePaginationCount = ids.size;
    await profile("after-complete-pagination");
    evidence.interactions = await measureDesktopInteractions(
      view.page,
      (samples) => {
        evidence.interactionProgress = samples;
      }
    );
    await profile("after-interactions");
    const database = await stat(
      path.join(
        directory,
        `library-${capacityIdentity.instanceId}-${capacityIdentity.accountId}.sqlite`
      )
    );
    evidence.databaseBytes = database.size;
    if (process.env.PR0_CAPACITY_RESIDENCY === "true") {
      evidence.residencyState = await prepareDesktopResidency(view.page);
      await profile("hidden-with-automation");
      // Detach the observer before settling; native-owned WebViews stay alive.
      await view.browser.close();
      automationConnected = false;
      evidence.automationDisconnectedBeforeResidency = true;
      await Bun.sleep(30_000);
      await profile("hidden-after-automation-disconnect");
      const sampler = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "apps/web/tests/capacity-residency.ps1",
          "-NativeProcessId",
          String(view.processId),
        ],
        { stdout: "pipe", stderr: "inherit" }
      );
      const output = await new Response(sampler.stdout).text();
      expect(await sampler.exited).toBe(0);
      const residency = z
        .object({
          intervalMs: z.number(),
          peakSampledPrivateBytes: z.number(),
          meanCpuPercentOfMachine: z.number(),
        })
        .parse(JSON.parse(output));
      await Bun.write("docs/evidence/issue-65-residency.json", output);
      evidence.residency = residency;
      await profile("after-ten-minutes");
      expect(residency.intervalMs).toBeGreaterThanOrEqual(599_000);
      expect(residency.peakSampledPrivateBytes).toBeLessThanOrEqual(
        314_572_800
      );
      expect(residency.meanCpuPercentOfMachine).toBeLessThan(1);
    }
    const targets = [
      ...results.map((result) => result.p95Ms <= 150),
      evidence.interactions.launcher.p95Ms <= 200,
      evidence.interactions.copy.p95Ms <= 150,
      evidence.interactions.save.p95Ms <= 200,
      evidence.processColdUiMs <= 3000,
      evidence.initialDownloadMs === undefined ||
        evidence.initialDownloadMs <= 120_000,
      evidence.residency === undefined ||
        (evidence.residency.peakSampledPrivateBytes <= 314_572_800 &&
          evidence.residency.meanCpuPercentOfMachine < 1),
    ];
    evidence.passed = targets.every(Boolean);
    for (const result of results) {
      expect(result.p95Ms, result.query).toBeLessThanOrEqual(150);
    }
    expect(evidence.interactions.copy.p95Ms).toBeLessThanOrEqual(150);
    expect(evidence.interactions.launcher.p95Ms).toBeLessThanOrEqual(200);
    expect(evidence.interactions.save.p95Ms).toBeLessThanOrEqual(200);
    expect(evidence.processColdUiMs).toBeLessThanOrEqual(3000);
    if (evidence.initialDownloadMs !== undefined) {
      expect(evidence.initialDownloadMs).toBeLessThanOrEqual(120_000);
    }
  } catch (error) {
    evidence.failure = String(error);
    throw error;
  } finally {
    await Bun.write(
      "docs/evidence/issue-65-desktop.json",
      `${JSON.stringify(evidence, null, 2)}\n`
    );
    await view?.stop();
    await native?.stop();
    if (previous === undefined) {
      delete process.env.PR0_SEARCH_FIXTURE_DIRECTORY;
    } else {
      process.env.PR0_SEARCH_FIXTURE_DIRECTORY = previous;
    }
    if (process.env.PR0_CAPACITY_KEEP !== "true" && !reused) {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
    await rm(fixture, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
}, 1_200_000);
