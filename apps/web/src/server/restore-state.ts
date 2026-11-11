import "server-only";
import { readFileSync } from "node:fs";

import { z } from "zod";

// Not strict: files written before ADR-0005 also carry the retired ledger
// checkpoint fields (pendingIntents, evidence), which are ignored and dropped.
export const restoreStateSchema = z.object({
  version: z.literal(1),
  phase: z.enum(["closed", "prepared", "open"]),
  instanceId: z.uuid(),
  epoch: z.uuid(),
  startedAt: z.iso.datetime(),
  authDigest: z.string(),
});
export type RestoreState = z.infer<typeof restoreStateSchema>;

export const readRestoreState = () => {
  const filename = process.env.PR0_RECOVERY_STATE_FILE;
  if (!filename) {
    return null;
  }
  // No cache: closing admission must reach every process, including warm ones.
  return restoreStateSchema.parse(JSON.parse(readFileSync(filename, "utf-8")));
};

export const assertRestoreAdmission = () => {
  const state = readRestoreState();
  if (state && state.phase !== "open") {
    throw new Error("Restore admission is closed");
  }
};

export const assertRestoreMail = () => {
  const state = readRestoreState();
  if (state?.phase === "closed") {
    throw new Error("Restore mail delivery is closed");
  }
};
