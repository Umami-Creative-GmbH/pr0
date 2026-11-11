import { z } from "zod";
/**
 * Manual restore step (ADR-0005): after restoring an older backup, re-apply
 * every deletion from the deletion log before reopening. Reads the log on
 * stdin; lines that are not deletion events are ignored. Idempotent.
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
