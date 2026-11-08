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

const [output] = process.argv.slice(2);
assert.ok(output, "Pass output JSON path");
const control = await mkdtemp(
  path.join(tmpdir(), "pr0-validation-scratch-65-")
);
const directory = path.join(control, "library");
await mkdir(directory);
const evidence = {
  recordedAt: new Date().toISOString(),
  classification:
    "Supporting public native search with an unavailable temporary volume and deliberately incomplete but structurally valid content postings. A private two-prompt fixture; not a capacity or installed-build certification.",
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
    { TEMP: missing, TMP: missing }
  );
  assert.equal(
    downloadStatusSchema.parse(await native.command("library_status")).complete,
    true
  );
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
