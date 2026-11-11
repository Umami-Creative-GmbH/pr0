import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { isDeletionLogFile } from "../src/lib/deletion-log-files";

/**
 * Manual restore step (ADR-0005): after restoring an older backup, re-apply
 * every deletion from the deletion log before reopening. Reads the log files
 * or stdin; lines that are not deletion events are ignored. Idempotent.
 */
const deletionLineSchema = z.object({
  event: z.enum(["account_deleted", "account_redeleted"]),
  accountId: z.uuid(),
  deletedAt: z.iso.datetime(),
});

export const deletionsFromLog = (log: string) => {
  const deletions = new Map<string, string>();
  for (const line of log.split(/\r?\n/u)) {
    // Container log collectors may prefix each line; the JSON object is the event.
    const start = line.indexOf("{");
    if (start === -1) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(start));
    } catch {
      continue;
    }
    const deletion = deletionLineSchema.safeParse(parsed);
    if (deletion.success && !deletions.has(deletion.data.accountId)) {
      deletions.set(deletion.data.accountId, deletion.data.deletedAt);
    }
  }
  return [...deletions].map(([accountId, deletedAt]) => ({
    accountId,
    deletedAt,
  }));
};

/**
 * Reads deletion log input for `deletions reapply`: each file as given, and
 * each directory's monthly `deletions-YYYY-MM.jsonl` files in name order.
 */
export const readDeletionLogInputs = async (inputs: string[]) => {
  const files: string[] = [];
  for (const input of inputs) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Inputs keep the operator's order.
    const entry = await stat(input);
    if (entry.isDirectory()) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Inputs keep the operator's order.
      const entries = await readdir(input);
      const names = entries.filter(isDeletionLogFile);
      // oxlint-disable-next-line unicorn/no-array-sort -- Newly allocated; ES2022 types.
      files.push(...names.sort().map((name) => path.join(input, name)));
    } else {
      files.push(input);
    }
  }
  const texts = await Promise.all(files.map((file) => Bun.file(file).text()));
  return texts.join("\n");
};
