import assert from "node:assert/strict";

import { downloadStatusSchema } from "@pr0/api-contract/snapshots";

import { localNativeWorker } from "./local-native-worker";

const [directory, output] = process.argv.slice(2);
assert.ok(
  directory && output,
  "Pass a retained maximum library and output JSON path"
);
const evidence = {
  recordedAt: new Date().toISOString(),
  classification:
    "Supporting native startup lower bound on the authorized host: process launch through the first typed library_status response on a retained maximum library. Excludes WebView/installed UI startup; no production synchronization or network certification.",
  fixtureDirectory: directory,
  nativeStartupMs: 0,
  downloaded: 0,
  textBytes: 0,
  complete: false,
  releaseCriteriaMet: false,
  failure: "",
};
const started = performance.now();
let native: Awaited<ReturnType<typeof localNativeWorker>> | undefined;
try {
  native = await localNativeWorker(directory, false, false, false, "release");
  const status = downloadStatusSchema.parse(
    await native.command("library_status")
  );
  evidence.nativeStartupMs = performance.now() - started;
  evidence.downloaded = status.downloaded;
  evidence.textBytes = status.textBytes;
  evidence.complete = status.complete;
  assert.equal(status.complete, true);
  assert.equal(status.downloaded, 10_000);
  assert.equal(status.textBytes, 104_857_600);
  process.stdout.write(
    `${JSON.stringify({ nativeStartupMs: evidence.nativeStartupMs, complete: status.complete, downloaded: status.downloaded })}\n`
  );
  assert.ok(
    evidence.nativeStartupMs <= 3000,
    "Native startup alone exceeds the three-second cold local start budget"
  );
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  await Bun.write(output, `${JSON.stringify(evidence, null, 2)}\n`);
  await native?.stop();
}
