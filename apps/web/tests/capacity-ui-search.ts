// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- UI samples must observe completed results in order.
import assert from "node:assert/strict";

import { measureSearch } from "./capacity-desktop-search";
import { capacityP95 } from "./capacity-statistics";
import { localNativeWorker } from "./local-native-worker";
import { nativeWebview } from "./native-webview";

const [directory, output] = process.argv.slice(2);
assert.ok(directory && output, "Pass retained maximum library and output JSON");
const results: { query: string; samples: number[]; p95Ms: number }[] = [];
const evidence = {
  recordedAt: new Date().toISOString(),
  classification:
    "Supporting focused real WebView search after process startup: input dispatch through committed results and two frames, including debounce. Not required-machine, installed-build or complete capacity certification.",
  browserDefaultsPreserved: true,
  releaseCriteriaMet: false,
  results,
  failure: "",
};
const native = await localNativeWorker(
  directory,
  false,
  false,
  false,
  "release"
);
await native.stop();
const view = await nativeWebview(native.executable, directory);
try {
  await view.page.locator("[data-search-query]").waitFor();
  for (const query of ["a", "abcd"]) {
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      samples.push(await measureSearch(view.page, query));
      assert.equal(
        await view.page
          .getByRole("list", { name: "Search results" })
          .getByRole("listitem")
          .count(),
        query === "abcd" ? 7 : 50
      );
    }
    results.push({ query, samples, p95Ms: capacityP95(samples) });
  }
  process.stdout.write(
    `${JSON.stringify(results.map(({ query, p95Ms }) => ({ query, p95Ms })))}\n`
  );
  assert.ok(
    results.every((result) => result.p95Ms <= 150),
    "Search p95 exceeds 150 ms"
  );
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  await Bun.write(output, `${JSON.stringify(evidence, null, 2)}\n`);
  await view.stop();
}
