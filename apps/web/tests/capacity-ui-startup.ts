// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each cold process exits before the next launch.
import assert from "node:assert/strict";

import { localNativeWorker } from "./local-native-worker";
import { nativeWebview } from "./native-webview";

const [directory, output] = process.argv.slice(2);
assert.ok(
  directory && output,
  "Pass a retained maximum library and output JSON"
);
const samples: number[] = [];
const evidence = {
  recordedAt: new Date().toISOString(),
  classification:
    "Supporting three process-cold UI opens on the authorized host, using a retained maximum library, real WebView2 and production assets. OS caches are not flushed; this is not installed-build cold-start p95 certification on the required machine.",
  fixtureDirectory: directory,
  browserDefaultsPreserved: true,
  releaseCriteriaMet: false,
  samplesMs: samples,
  failure: "",
};
try {
  const native = await localNativeWorker(
    directory,
    false,
    false,
    false,
    "release"
  );
  await native.stop();
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    const view = await nativeWebview(native.executable, directory);
    try {
      await view.page.locator("[data-search-query]").waitFor();
      assert.equal(
        await view.page
          .getByRole("list", { name: "Search results" })
          .getByRole("listitem")
          .count(),
        50
      );
      samples.push(performance.now() - started);
    } finally {
      await view.stop();
    }
  }
  process.stdout.write(`${JSON.stringify({ samplesMs: samples })}\n`);
  assert.ok(
    samples.every((sample) => sample <= 3000),
    "A process-cold UI open exceeds three seconds"
  );
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  await Bun.write(output, `${JSON.stringify(evidence, null, 2)}\n`);
}
