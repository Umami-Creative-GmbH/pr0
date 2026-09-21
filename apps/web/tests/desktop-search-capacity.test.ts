// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Download acknowledgements and benchmark samples are sequential.
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { cpus, tmpdir, totalmem } from "node:os";
import path from "node:path";

import { localNativeWorker } from "./local-native-worker";
import { nativeWebview } from "./native-webview";

const phrase =
  "write concise answer useful examples clear steps review following document identify important changes explain reasoning preserve exact names punctuation summarize meeting notes actions owners dates common C++ abc bcd ";
test("persisted maximum offline library records cold and warm production UI retrieval", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-search-capacity-"));
  const fixture = await mkdtemp(path.join(tmpdir(), "pr0-search-download-"));
  const original = process.env.PR0_SEARCH_FIXTURE_DIRECTORY;
  const identity = {
    instanceId: "11111111-1111-4111-8111-111111111111",
    accountId: "33333333-3333-4333-8333-333333333333",
  };
  const id = "55555555-5555-4555-8555-555555555555";
  const pages = [];
  for (let page = 0; page < 100; page += 1) {
    const prompts = Array.from({ length: 100 }, (_, index) => {
      const number = page * 100 + index + 1;
      return {
        ...identity,
        id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
        title: `Prompt ${String(number).padStart(5, "0")}`,
        description: "",
        content: phrase.repeat(60).slice(0, 10_473 + Number(number <= 7600)),
        revision: String(number),
        createdAt: "2026-01-01T00:00:00.000Z",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        favorite: false,
        archived: false,
        collectionId: null,
        tagIds: [],
        useCount: 0,
        lastUsedAt: null,
        sourceTitle: null,
      };
    });
    const payload = JSON.stringify({
      organization:
        page === 0
          ? {
              ...identity,
              revision: "10000",
              textBytes: 104_857_600,
              collections: [],
              tags: [],
            }
          : null,
      prompts,
    });
    pages.push({
      bytes: Buffer.byteLength(payload),
      digest: new Bun.CryptoHasher("sha256").update(payload).digest("hex"),
    });
    await Bun.write(
      path.join(fixture, `page-${page}.json`),
      JSON.stringify({ id, page, payload })
    );
  }
  await Bun.write(
    path.join(fixture, "manifest.json"),
    JSON.stringify({
      ...identity,
      id,
      epoch: "88888888-8888-4888-8888-888888888888",
      version: 1,
      normalization: "pr0-search-v1-ucd17",
      revision: "10000",
      expiresAt: "2099-01-01T00:00:00.000Z",
      promptCount: 10_000,
      pages,
    })
  );
  process.env.PR0_SEARCH_FIXTURE_DIRECTORY = fixture;
  const native = await localNativeWorker(
    directory,
    true,
    false,
    false,
    "release"
  );
  const started = performance.now();
  for (let page = 2; page < 100; page += 1) {
    await native.command("library_download");
  }
  const prepareMs = performance.now() - started;
  expect(await native.command("library_status")).toMatchObject({
    complete: true,
    downloaded: 10_000,
    textBytes: 104_857_600,
  });
  await native.stop();
  const coldStart = performance.now();
  const webview = await nativeWebview(native.executable, directory);
  const { browser, page } = webview;
  try {
    await page.locator('[data-search-query=""]').waitFor();
    const processColdUiMs = performance.now() - coldStart;
    const results = [];
    for (const query of [
      "a",
      "C++",
      "common",
      "abcd",
      "prompt common",
      phrase.slice(0, 197),
    ]) {
      const samples = [];
      let firstQueryMs = 0;
      for (let sample = 0; sample < 21; sample += 1) {
        await page
          .getByRole("searchbox", { name: "Search downloaded prompts" })
          .fill("");
        await page.locator('[data-search-query=""]').waitFor();
        const duration = await page.evaluate(async (value) => {
          const input = document.querySelector<HTMLInputElement>(
            'input[type="search"]:not(details input)'
          );
          if (!input) {
            throw new Error("Missing search field");
          }
          const start = performance.now();
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          )?.set;
          setter?.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const completed = Promise.withResolvers<undefined>();
          const observer = new MutationObserver(() => {
            const result = document.querySelector<HTMLElement>(
              "[data-search-query]"
            );
            if (result?.dataset.searchQuery === value) {
              observer.disconnect();
              requestAnimationFrame(() => completed.resolve());
            }
          });
          const timeout = setTimeout(() => {
            observer.disconnect();
            completed.reject(new Error("Search timed out"));
          }, 10_000);
          observer.observe(document.body, {
            subtree: true,
            attributes: true,
            childList: true,
          });
          await completed.promise;
          clearTimeout(timeout);
          return performance.now() - start;
        }, query);
        expect(
          await page
            .getByRole("list", { name: "Search results" })
            .getByRole("listitem")
            .count()
        ).toBe(query === "abcd" ? 0 : 50);
        if (sample) {
          samples.push(duration);
        } else {
          firstQueryMs = duration;
        }
      }
      samples.sort((a, b) => a - b);
      results.push({ query, firstQueryMs, samples, p95Ms: samples[18] });
    }
    const database = await stat(
      path.join(
        directory,
        `library-${identity.instanceId}-${identity.accountId}.sqlite`
      )
    );
    await Bun.write(
      "docs/evidence/issue-50-search-capacity.json",
      JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          cpu: cpus()[0]?.model,
          memoryBytes: totalmem(),
          bun: Bun.version,
          browser: browser.version(),
          surface:
            "Production Tauri desktop assets, WebView2, native IPC and SQLite",
          cache:
            "New native process, OS file cache uncontrolled; warm samples include 20 ms debounce and rendering",
          prepareMs,
          processColdUiMs,
          databaseBytes: database.size,
          promptCount: 10_000,
          textBytes: 104_857_600,
          results,
        },
        null,
        2
      )
    );
    await page.screenshot({
      path: "docs/evidence/issue-50-desktop-search.png",
      fullPage: true,
    });
    for (const result of results) {
      expect(result.p95Ms, result.query).toBeLessThanOrEqual(150);
    }
  } finally {
    await webview.stop();
    if (original === undefined) {
      delete process.env.PR0_SEARCH_FIXTURE_DIRECTORY;
    } else {
      process.env.PR0_SEARCH_FIXTURE_DIRECTORY = original;
    }
    await rm(directory, { recursive: true, force: true });
    await rm(fixture, { recursive: true, force: true });
  }
}, 900_000);
