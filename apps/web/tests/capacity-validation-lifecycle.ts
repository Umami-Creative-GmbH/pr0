// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each lifecycle check owns and stops one native process before the next begins.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { downloadStatusSchema } from "@pr0/api-contract/snapshots";

import { localNativeWorker } from "./local-native-worker";

const [directory, output] = process.argv.slice(2);
assert.ok(
  directory && output,
  "Pass a retained maximum library and output JSON"
);
interface ValidationLifecycleEvidence {
  recordedAt: string;
  classification: string;
  releaseCriteriaMet: false;
  runs: {
    mode: string;
    activeTemporaryFiles: number;
    remainingTemporaryFiles: number;
    shutdownMs: number;
  }[];
  failure: string;
}
const evidence: ValidationLifecycleEvidence = {
  recordedAt: new Date().toISOString(),
  classification:
    "Supporting lifecycle check: pause a real maximum-library validation snapshot, release full content checking, then verify native graceful and forced exit interrupt it and remove SQLite temporary files. No production synchronization or installed-build certification.",
  releaseCriteriaMet: false,
  runs: [],
  failure: "",
};
try {
  for (const mode of ["graceful", "forced"]) {
    const control = await mkdtemp(path.join(tmpdir(), "pr0-validation-65-"));
    const temporary = path.join(control, "sqlite-temp");
    await mkdir(temporary);
    let stopped = false;
    const native = await localNativeWorker(
      directory,
      false,
      false,
      false,
      "release",
      false,
      {
        PR0_SEARCH_VALIDATION_TEST_GATE: control,
        TEMP: temporary,
        TMP: temporary,
      }
    );
    try {
      const status = downloadStatusSchema.parse(
        await native.command("library_status")
      );
      assert.equal(status.complete, true);
      assert.equal(status.downloaded, 10_000);
      const deadline = performance.now() + 20_000;
      while (!(await Bun.file(path.join(control, "snapshot-ready")).exists())) {
        assert.ok(
          performance.now() < deadline,
          "Validation snapshot did not become ready"
        );
        await Bun.sleep(10);
      }
      const active = await readdir(temporary);
      assert.ok(
        active.length > 0,
        "The complete snapshot must spill to the isolated temporary volume"
      );
      await Bun.write(path.join(control, "release"), "release");
      while (
        !(await Bun.file(path.join(control, "content-check-started")).exists())
      ) {
        assert.ok(
          performance.now() < deadline,
          "Full content validation did not start"
        );
        await Bun.sleep(5);
      }
      const closing = performance.now();
      if (mode === "forced") {
        process.kill(native.processId, "SIGKILL");
        await native.exited;
      } else {
        await native.stop();
      }
      stopped = true;
      const shutdownMs = performance.now() - closing;
      const remaining = await readdir(temporary);
      evidence.runs.push({
        mode,
        activeTemporaryFiles: active.length,
        remainingTemporaryFiles: remaining.length,
        shutdownMs,
      });
      assert.equal(
        remaining.length,
        0,
        "SQLite validation snapshot survived native exit"
      );
      assert.ok(
        shutdownMs < 2000,
        "Exit waited for the full content validation"
      );
    } finally {
      if (!stopped) {
        await native.stop();
      }
      assert.equal(path.dirname(path.resolve(control)), path.resolve(tmpdir()));
      assert.ok(path.basename(control).startsWith("pr0-validation-65-"));
      await rm(control, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
  }
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  await Bun.write(output, `${JSON.stringify(evidence, null, 2)}\n`);
}
