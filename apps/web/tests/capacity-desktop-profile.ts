// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Profile one native application and its phases in order.
import assert from "node:assert/strict";
import { cpus, release, totalmem } from "node:os";

import { z } from "zod";

import { nativeWebview } from "./native-webview";

const processSchema = z.array(
  z.object({
    id: z.number(),
    parent: z.number(),
    name: z.string(),
    role: z.string(),
    privateBytes: z.number(),
  })
);
export interface ProfilePhase {
  name: string;
  elapsedMs: number;
  totalPrivateBytes: number;
  processes: z.infer<typeof processSchema>;
  automationConnected: boolean;
  pages: { url: string; heap: unknown; dom: unknown }[];
}
export const profileDesktopPhase = async (
  view: Awaited<ReturnType<typeof nativeWebview>>,
  name: string,
  started: number,
  automationConnected = true
): Promise<ProfilePhase> => {
  const child = Bun.spawn(
    [
      "powershell.exe",
      "-NoProfile",
      "-File",
      "apps/web/tests/capacity-process-snapshot.ps1",
      "-NativeProcessId",
      String(view.processId),
    ],
    { stdout: "pipe", stderr: "inherit" }
  );
  const processes = processSchema.parse(
    await new Response(child.stdout).json()
  );
  assert.equal(await child.exited, 0);
  const pages = [];
  for (const page of automationConnected
    ? (view.browser.contexts()[0]?.pages() ?? [])
    : []) {
    const session = await page.context().newCDPSession(page);
    pages.push({
      url: page.url(),
      heap: await session.send("Runtime.getHeapUsage"),
      dom: await session.send("Memory.getDOMCounters"),
    });
    await session.detach();
  }
  const phase = {
    name,
    elapsedMs: performance.now() - started,
    totalPrivateBytes: processes.reduce(
      (sum, entry) => sum + entry.privateBytes,
      0
    ),
    processes,
    automationConnected,
    pages,
  };
  process.stdout.write(
    `${JSON.stringify({ name, privateBytes: phase.totalPrivateBytes })}\n`
  );
  return phase;
};
const runProfile = async () => {
  const [executable, directory, output] = process.argv.slice(2);
  assert.ok(
    executable && directory && output,
    "Pass the release test executable, retained library directory and output JSON path"
  );
  const phases: ProfilePhase[] = [];
  const evidence = {
    recordedAt: new Date().toISOString(),
    classification:
      "Supporting startup/memory profile: unrestricted host, retained maximum-library fixture, release native test worker and production WebView assets; no production synchronization loops. Point samples are not the ten-minute residency gate.",
    executable,
    fixtureDirectory: directory,
    bun: Bun.version,
    windowsRelease: release(),
    browserVersion: "",
    settleMs: 30_000,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    hostMemoryBytes: totalmem(),
    startupMs: 0,
    releaseCriteriaMet: false,
    phases,
    failure: "",
  };
  const started = performance.now();
  const view = await nativeWebview(executable, directory);
  evidence.browserVersion = view.browser.version();
  const snapshot = async (name: string) => {
    const phase = await profileDesktopPhase(view, name, started);
    phases.push(phase);
    return phase;
  };

  try {
    await view.page.locator("[data-search-query]").waitFor();
    assert.equal(
      await view.page
        .getByRole("list", { name: "Search results" })
        .getByRole("listitem")
        .count(),
      50
    );
    evidence.startupMs = performance.now() - started;
    await snapshot("initial-render");
    await view.page
      .getByRole("searchbox", { name: "Search downloaded prompts" })
      .fill("abcd");
    await view.page.locator('[data-search-query="abcd"]').waitFor();
    assert.equal(
      await view.page
        .getByRole("list", { name: "Search results" })
        .getByRole("listitem")
        .count(),
      7
    );
    await snapshot("exact-verification-query");
    await view.page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("resident_hide", {})
    );
    await Bun.sleep(30_000);
    const hidden = await snapshot("hidden-thirty-seconds");
    process.stdout.write(`Cold UI: ${evidence.startupMs} ms\n`);
    assert.ok(
      hidden.totalPrivateBytes <= 314_572_800,
      "Summed native + WebView private commit exceeds 300 MiB"
    );
    assert.ok(evidence.startupMs <= 3000, "Cold UI exceeds 3 seconds");
  } catch (error) {
    evidence.failure = String(error);
    throw error;
  } finally {
    await Bun.write(output, `${JSON.stringify(evidence, null, 2)}\n`);
    await view.stop();
  }
};

if (import.meta.main) {
  await runProfile();
}
