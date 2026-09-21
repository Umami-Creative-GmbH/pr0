import "server-only";
import { readFileSync } from "node:fs";

import { deletionClaimsSchema } from "@pr0/api-contract/deletions";
import { z } from "zod";

export const restoreStateSchema = z.strictObject({
  version: z.literal(1),
  phase: z.enum(["closed", "prepared", "open"]),
  instanceId: z.uuid(),
  epoch: z.uuid(),
  startedAt: z.iso.datetime(),
  authDigest: z.string(),
  pendingIntents: z.array(deletionClaimsSchema).default([]),
  evidence: z
    .object({ count: z.number().int().positive(), digest: z.string() })
    .nullable(),
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
