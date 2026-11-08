// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Replay the same native requests and capture phases sequentially.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { z } from "zod";

import { snapshotDesktopProcesses } from "./capacity-desktop-profile";

const eventSchema = z.object({
  phase: z.enum(["ready", "query-start", "queried", "hidden", "failed"]),
  at: z.number(),
  completedQueries: z.number().int().min(0).max(100),
  elements: z.number().int(),
  error: z.string(),
});
const [executable, directory, mode, output] = process.argv.slice(2);
assert.ok(
  executable && directory && output,
  "Pass executable, retained library, observed/unobserved and output JSON"
);
const observed = z.enum(["observed", "unobserved"]).parse(mode) === "observed";
const control = await mkdtemp(path.join(tmpdir(), "pr0-observer-65-"));
const script = path.join(control, "probe.js");
const progress = path.join(control, "progress.jsonl");
const build = await Bun.build({
  entrypoints: ["apps/web/tests/capacity-desktop-observer-page.ts"],
  target: "browser",
  format: "iife",
  minify: true,
});
assert.ok(build.success, "Probe browser bundle failed");
const [compiled] = build.outputs;
assert.ok(compiled);
await Bun.write(script, compiled);
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const { port } = reservation;
await reservation.stop(true);
const started = performance.now();
const child = Bun.spawn(
  [
    executable,
    "--exact",
    "auth_tests::desktop_search_webview_worker",
    "--nocapture",
  ],
  {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      PR0_SEARCH_WEBVIEW_DIRECTORY: directory,
      PR0_CAPACITY_PROBE_SCRIPT: script,
      PR0_CAPACITY_PROBE_OUTPUT: progress,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: observed
        ? `--remote-debugging-port=${port} --lang=en-US --accept-lang=en-US`
        : "--lang=en-US --accept-lang=en-US",
    },
  }
);
interface ProbePhase {
  event: z.infer<typeof eventSchema>;
  observedAt: number;
  processes: Awaited<ReturnType<typeof snapshotDesktopProcesses>>;
  totalPrivateBytes: number;
}
const phases: ProbePhase[] = [];
const browserErrors: string[] = [];
const evidence = {
  recordedAt: new Date().toISOString(),
  classification:
    "Supporting diagnostic: 100 identical public native search IPC requests with fixed visible UI, then 30 seconds hidden. No Copy/Save journey, network shaping or ten-minute residency certification. No forced GC.",
  releaseCriteriaMet: false,
  observed,
  browserDefaultsPreserved: true,
  observerAttachedAt: 0,
  executable,
  fixtureDirectory: directory,
  phases,
  browserErrors,
  failure: "",
};
let browser: Browser | undefined;
try {
  const deadline = performance.now() + 90_000;
  if (observed) {
    while (!browser) {
      assert.ok(performance.now() < deadline, "Observer did not attach");
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
          noDefaults: true,
          timeout: 1000,
        });
        evidence.observerAttachedAt = Date.now();
        for (const context of browser.contexts()) {
          const observePage = (page: Page) =>
            page.on("pageerror", (error) => {
              browserErrors.push(String(error));
            });
          context.on("page", observePage);
          for (const page of context.pages()) {
            observePage(page);
          }
        }
      } catch {
        await Bun.sleep(100);
      }
    }
  }
  let consumed = 0;
  let complete = false;
  while (!complete) {
    assert.ok(performance.now() < deadline, "Probe did not finish");
    assert.equal(browserErrors.length, 0, browserErrors.join("\n"));
    if (!(await Bun.file(progress).exists())) {
      await Bun.sleep(100);
      continue;
    }
    const text = await Bun.file(progress).text();
    if (!text.endsWith("\n")) {
      await Bun.sleep(100);
      continue;
    }
    const events = text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => eventSchema.parse(JSON.parse(line)));
    for (const event of events.slice(consumed)) {
      consumed += 1;
      assert.notEqual(event.phase, "failed", event.error);
      if (event.phase === "query-start") {
        assert.ok(
          !observed || evidence.observerAttachedAt <= event.at,
          "Observer attached after work started"
        );
        continue;
      }
      const processes = await snapshotDesktopProcesses(child.pid);
      const phase = {
        event,
        observedAt: Date.now(),
        processes,
        totalPrivateBytes: processes.reduce(
          (sum, entry) => sum + entry.privateBytes,
          0
        ),
      };
      evidence.phases.push(phase);
      process.stdout.write(
        `${JSON.stringify({ phase: event.phase, privateBytes: phase.totalPrivateBytes })}\n`
      );
      if (event.phase === "hidden") {
        assert.equal(event.completedQueries, 100);
        complete = true;
      }
    }
    await Bun.sleep(100);
  }
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  await Bun.write(
    output,
    `${JSON.stringify({ ...evidence, elapsedMs: performance.now() - started }, null, 2)}\n`
  );
  await browser?.close();
  child.kill();
  await child.exited;
  assert.equal(path.dirname(path.resolve(control)), path.resolve(tmpdir()));
  assert.ok(path.basename(control).startsWith("pr0-observer-65-"));
  await rm(control, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
