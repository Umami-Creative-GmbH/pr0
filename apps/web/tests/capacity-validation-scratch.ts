import { Database } from "bun:sqlite";
// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Native lifecycle and sequential public requests preserve the test's ordering.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { desktopSearchPageSchema } from "@pr0/api-contract/desktop-search";
import { downloadStatusSchema } from "@pr0/api-contract/snapshots";

import { capacityIdentity } from "./capacity-snapshot";
import { localNativeWorker } from "./local-native-worker";

const [output, mode = "unavailable-volume"] = process.argv.slice(2);
assert.ok(
  ["unavailable-volume", "snapshot-full"].includes(mode),
  "Unknown scratch failure mode"
);
assert.ok(output, "Pass output JSON path");
const control = await mkdtemp(
  path.join(tmpdir(), "pr0-validation-scratch-65-")
);
const directory = path.join(control, "library");
await mkdir(directory);
const evidence = {
  recordedAt: new Date().toISOString(),
  classification:
    "Supporting public native search with deliberately incomplete content postings and either an unavailable temporary volume or a test-only SQLite snapshot page quota. The latter forces real SQLITE_FULL during backup without filling the host disk. Private two-prompt fixture; no capacity certification.",
  mode,
  snapshotDiskFull: false,
  releaseCriteriaMet: false,
  queries: 0,
  postingsStillRequireRecovery: false,
  failure: "",
};
let native: Awaited<ReturnType<typeof localNativeWorker>> | undefined;
try {
  native = await localNativeWorker(directory, true, false, false, "release");
  assert.equal(
    downloadStatusSchema.parse(await native.command("library_status")).complete,
    true
  );
  await native.stop();
  native = undefined;
  const database = path.join(
    directory,
    `library-${capacityIdentity.instanceId}-${capacityIdentity.accountId}.sqlite`
  );
  const setup = new Database(database);
  setup.run(
    "INSERT INTO local_f_content(local_f_content) VALUES('delete-all');"
  );
  setup.close();
  const missing = path.join(control, "unavailable-volume");
  native = await localNativeWorker(
    directory,
    true,
    false,
    false,
    "release",
    false,
    mode === "snapshot-full"
      ? {
          PR0_SEARCH_VALIDATION_TEST_MAX_PAGES: "1",
          PR0_SEARCH_VALIDATION_TEST_GATE: control,
        }
      : { TEMP: missing, TMP: missing }
  );
  assert.equal(
    downloadStatusSchema.parse(await native.command("library_status")).complete,
    true
  );
  await native.command("library_search", {
    request: {
      ...capacityIdentity,
      generation: native.generation,
      requestId: crypto.randomUUID(),
      query: "",
      limit: 50,
      view: "all",
      sort: "relevance",
      tagIds: [],
    },
  });
  if (mode === "snapshot-full") {
    const marker = path.join(control, "backup-disk-full");
    const deadline = performance.now() + 10_000;
    while (!(await Bun.file(marker).exists())) {
      assert.ok(
        performance.now() < deadline,
        "Snapshot backup did not hit SQLITE_FULL"
      );
      await Bun.sleep(5);
    }
    assert.equal(await Bun.file(marker).text(), "SQLITE_FULL");
    evidence.snapshotDiskFull = true;
  }
  for (let sample = 0; sample < 3; sample += 1) {
    const page = desktopSearchPageSchema.parse(
      await native.command("library_search", {
        request: {
          ...capacityIdentity,
          generation: native.generation,
          requestId: crypto.randomUUID(),
          query: "Hello",
          limit: 50,
          view: "all",
          sort: "relevance",
          tagIds: [],
        },
      })
    );
    assert.equal(page.prompts.length, 2);
    evidence.queries += 1;
  }
  await native.stop();
  native = undefined;
  const checked = new Database(database);
  try {
    checked.run(
      "INSERT INTO local_f_content(local_f_content,rank) VALUES('integrity-check',1);"
    );
  } catch {
    evidence.postingsStillRequireRecovery = true;
  } finally {
    checked.close();
  }
  assert.ok(
    evidence.postingsStillRequireRecovery,
    "The unavailable scratch volume must not silently rebuild or trust incomplete postings"
  );
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  await native?.stop();
  await Bun.write(output, `${JSON.stringify(evidence, null, 2)}\n`);
  assert.equal(path.dirname(path.resolve(control)), path.resolve(tmpdir()));
  assert.ok(path.basename(control).startsWith("pr0-validation-scratch-65-"));
  await rm(control, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
