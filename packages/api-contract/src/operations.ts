import { z } from "zod";

import { readinessResponseSchema } from "./health";

export const storageNameSchema = z.enum([
  "database",
  "search",
  "ledger-a",
  "ledger-b",
  "backup",
]);
const count = z.number().nonnegative().finite();
const queue = z.strictObject({
  active: count,
  queued: count,
  oldestSeconds: count,
});
export const operationalMetricsSchema = z.strictObject({
  sampledAt: z.iso.datetime(),
  readiness: readinessResponseSchema,
  requests: queue,
  search: queue.extend({ laggingLibraries: count, revisionLag: count }),
  waitingPolls: count,
  email: z.strictObject({
    pending: count,
    failed: count,
    oldestSeconds: count,
  }),
  storage: z.strictObject({
    databaseBytes: count,
    logicalTextBytes: count,
    historyBytes: count,
    walBytes: count.nullable(),
    volumes: z.array(
      z.strictObject({
        name: storageNameSchema,
        totalBytes: count,
        usedBytes: count,
        usedPercent: count,
        sampledAt: z.iso.datetime(),
        stale: z.boolean(),
      })
    ),
  }),
  backup: z.strictObject({
    status: z.enum(["ready", "unavailable"]),
    checkpoint: z.iso.datetime().nullable(),
    retentionOk: z.boolean(),
  }),
  ledger: z.strictObject({
    status: z.enum(["ready", "unavailable"]),
    bytes: count.nullable(),
    pendingDeletions: count,
  }),
  errors: z.array(
    z.strictObject({
      boundary: z.enum(["account", "request", "mutation"]),
      code: z.string(),
      count,
    })
  ),
  alerts: z.array(z.string()),
});
export type OperationalMetrics = z.infer<typeof operationalMetricsSchema>;
