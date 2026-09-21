import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

import { secret } from "../src/server/config";
import { database } from "../src/server/database";
import { closeLedgerStores } from "../src/server/deletion-ledger";
import { readReadiness } from "../src/server/readiness";
import { readRestoreState } from "../src/server/restore-state";
import type { RestoreState } from "../src/server/restore-state";
import { auditDeletedData, evidenceCheckpoint } from "./restore-evidence";
import {
  checkRestoreEvidence,
  prepareRestore,
  registerPendingRestore,
} from "./restore-prepare";

export const authDigest = () =>
  new Bun.CryptoHasher("sha256")
    .update(secret("BETTER_AUTH_SECRET"))
    .digest("hex");
export const saveRestoreState = (state: RestoreState) => {
  const filename = process.env.PR0_RECOVERY_STATE_FILE;
  if (!filename) {
    throw new Error(
      "Configure PR0_RECOVERY_STATE_FILE on persistent storage outside the database"
    );
  }
  const directory = path.dirname(filename);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(state));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, filename);
  if (process.platform !== "win32") {
    const directoryFd = openSync(directory, "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  }
};

if (import.meta.main) {
  process.chdir(path.resolve(import.meta.dir, ".."));
  const coordinator = await database().reserve();
  let locked = false;
  try {
    const [lock] =
      await coordinator`SELECT pg_try_advisory_lock(24001) AS acquired`;
    if (!lock.acquired) {
      throw new Error("Another restore or migration coordinator is active");
    }
    locked = true;
    const [command, recoveredInstanceId] = process.argv.slice(2);
    const [instance] =
      command === "close" && recoveredInstanceId
        ? [
            {
              id: z.uuid().parse(recoveredInstanceId),
              recovery_epoch: crypto.randomUUID(),
            },
          ]
        : await database()`SELECT id,recovery_epoch FROM instance`;
    if (!instance) {
      throw new Error("Instance unavailable");
    }
    if (command === "initialize") {
      const [accounts] =
        await database()`SELECT count(*)::int AS count FROM "user"`;
      if (
        accounts.count ||
        (await Bun.file(process.env.PR0_RECOVERY_STATE_FILE ?? "").exists())
      ) {
        throw new Error(
          "Initialize only a new empty instance with no recovery state"
        );
      }
      saveRestoreState({
        version: 1,
        phase: "open",
        instanceId: instance.id,
        epoch: instance.recovery_epoch,
        startedAt: new Date().toISOString(),
        authDigest: authDigest(),
        pendingIntents: [],
        evidence: null,
      });
    } else if (command === "close") {
      const previous = (await Bun.file(
        process.env.PR0_RECOVERY_STATE_FILE ?? ""
      ).exists())
        ? readRestoreState()
        : null;
      if (previous && previous.instanceId !== instance.id) {
        throw new Error("Recovery state belongs to another instance");
      }
      if (!previous || previous.phase === "open") {
        saveRestoreState({
          version: 1,
          phase: "closed",
          instanceId: instance.id,
          epoch: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          authDigest: authDigest(),
          pendingIntents: [],
          evidence: null,
        });
      }
    } else {
      const state = readRestoreState();
      if (
        !state ||
        state.phase === "open" ||
        state.instanceId !== instance.id
      ) {
        throw new Error(
          "Close admission for the correct immutable instance first"
        );
      }
      if (command === "seal") {
        if (state.evidence) {
          await checkRestoreEvidence(state);
        } else {
          saveRestoreState({
            ...state,
            evidence: await evidenceCheckpoint(state.instanceId),
          });
        }
      } else if (command === "prepare") {
        if (authDigest() === state.authDigest) {
          throw new Error(
            "Rotate BETTER_AUTH_SECRET before preparation to invalidate stateless action tokens"
          );
        }
        const registered = await registerPendingRestore(state);
        // Persist exact permitted additions before replay can append any new intent.
        saveRestoreState(registered);
        await prepareRestore(registered);
        saveRestoreState({ ...registered, phase: "prepared" });
      } else if (command === "open") {
        if (
          state.phase !== "prepared" ||
          instance.recovery_epoch !== state.epoch ||
          authDigest() === state.authDigest
        ) {
          throw new Error("Preparation and secret rotation are required");
        }
        await checkRestoreEvidence(state);
        const deletedAccounts = await auditDeletedData(state.instanceId);
        const readiness = await readReadiness(true);
        if (readiness.status !== "ready") {
          throw new Error("Readiness failed; keep admission closed");
        }
        const [backup] =
          await database()`SELECT checkpoint FROM backup_observation WHERE retention_ok
          AND checkpoint>=${new Date(state.startedAt)} AND checkpoint>clock_timestamp()-interval '1 hour'
          AND verified_at>clock_timestamp()-interval '1 hour'`;
        if (!backup) {
          throw new Error(
            "Verify a fresh encrypted backup and retention before reopening"
          );
        }
        saveRestoreState({ ...state, phase: "open", authDigest: authDigest() });
        process.stdout.write(
          `${JSON.stringify({ event: "restore_opened", deletedAccounts, recoverySeconds: (Date.now() - Date.parse(state.startedAt)) / 1000 })}\n`
        );
      } else {
        throw new Error("Use initialize, close, seal, prepare, or open");
      }
    }
    process.stdout.write('{"event":"restore_admission_updated"}\n');
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Restore failed; admission stays closed"}\n`
    );
    process.exitCode = 1;
  } finally {
    if (locked) {
      await coordinator`SELECT pg_advisory_unlock(24001)`;
    }
    coordinator.release();
    await closeLedgerStores();
    await database().close();
  }
}
