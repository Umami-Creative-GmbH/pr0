// oxlint-disable react-doctor/server-sequential-independent-await -- Private aggregate probes use bounded pools and yield between groups to preserve foreground database capacity.
import "server-only";
import { timingSafeEqual } from "node:crypto";

import { operationalMetricsSchema } from "@pr0/api-contract/operations";

import { secret } from "./config";
import { database } from "./database";
import { ledgerConnections, readEvidence } from "./deletion-ledger";
import { readReadiness } from "./readiness";

const storageAlerts = (
  volumes: { name: string; stale: boolean; usedPercent: number }[]
) => {
  const alerts = new Set<string>();
  for (const name of ["database", "search", "ledger-a", "ledger-b", "backup"]) {
    const volume = volumes.find((entry) => entry.name === name && !entry.stale);
    if (!volume) {
      alerts.add("storage_coverage_missing");
    } else if (volume.usedPercent >= 80) {
      alerts.add(`storage_critical:${name}`);
    } else if (volume.usedPercent >= 70) {
      alerts.add(`storage_expand:${name}`);
    }
  }
  return [...alerts];
};

export const readOperationalMetrics = async () => {
  const sql = database();
  const [
    requests,
    search,
    polls,
    email,
    storage,
    volumes,
    backup,
    errors,
    pending,
    readiness,
  ] = await Promise.all([
    sql`SELECT count(*) FILTER(WHERE active)::int AS active,count(*) FILTER(WHERE NOT active)::int AS queued,
      COALESCE(max(extract(epoch FROM clock_timestamp()-queued_at)) FILTER(WHERE NOT active),0)::float AS "oldestSeconds"
      FROM request_work WHERE expires_at>clock_timestamp()`,
    sql`SELECT count(*) FILTER(WHERE active)::int AS active,count(*) FILTER(WHERE NOT active)::int AS queued,
      COALESCE(max(extract(epoch FROM clock_timestamp()-queued_at)) FILTER(WHERE NOT active),0)::float AS "oldestSeconds"
      FROM search_work WHERE expires_at>clock_timestamp()`,
    sql`SELECT count(*)::int AS count FROM waiting_poll WHERE expires_at>clock_timestamp()`,
    sql`SELECT count(*) FILTER(WHERE state='pending')::int AS pending,count(*) FILTER(WHERE state IN ('failed','expired'))::int AS failed,
      COALESCE(max(extract(epoch FROM clock_timestamp()-created_at)) FILTER(WHERE state='pending'),0)::float AS "oldestSeconds" FROM mail_job`,
    sql`SELECT pg_database_size(current_database())::float AS "databaseBytes",
      (SELECT COALESCE(sum(text_bytes),0)::float FROM library) AS "logicalTextBytes",
      (pg_total_relation_size('library_operation')+pg_total_relation_size('library_operation_attempt')+
       pg_total_relation_size('library_change')+pg_total_relation_size('library_snapshot_page')+pg_total_relation_size('prompt_deletion'))::float AS "historyBytes"`,
    sql<
      {
        name: string;
        totalBytes: number;
        usedBytes: number;
        percent: string;
        sampled_at: Date;
        stale: boolean;
      }[]
    >`SELECT name,total_bytes::float AS "totalBytes",used_bytes::float AS "usedBytes",
      100.0*used_bytes/total_bytes AS percent,sampled_at, sampled_at<clock_timestamp()-interval '5 minutes' AS stale FROM storage_observation ORDER BY name`,
    sql`SELECT checkpoint,retention_ok, checkpoint>clock_timestamp()-interval '1 hour' AND verified_at>clock_timestamp()-interval '1 hour' AND retention_ok AS ready FROM backup_observation`,
    sql`SELECT boundary,code,sum(count)::float AS count FROM operational_counter WHERE day>=CURRENT_DATE-30 GROUP BY boundary,code ORDER BY boundary,code`,
    sql`SELECT count(*)::int AS count FROM account_deletion_pending`,
    readReadiness(),
  ]);
  const [lag] =
    await sql`SELECT count(*)::int AS "laggingLibraries",COALESCE(sum(l.revision-COALESCE(h.revision,0)),0)::float AS "revisionLag"
    FROM library l CROSS JOIN instance i LEFT JOIN search_projection_health h ON h.account_id=l.account_id AND h.epoch=i.recovery_epoch
    WHERE l.revision>COALESCE(h.revision,0)`;
  let walBytes: number | null = null;
  try {
    const [wal] =
      await sql`SELECT COALESCE(sum(size),0)::float AS bytes FROM pg_ls_waldir()`;
    walBytes = wal.bytes;
  } catch {
    /* Missing monitoring permissions are reported as missing coverage. */
  }
  let ledgerBytes: number | null = null;
  try {
    const [instance] = await sql`SELECT id FROM instance`;
    await readEvidence(instance.id, "health");
    const sizes = await Promise.all(
      ledgerConnections().map(async (ledger) => {
        const [size] =
          await ledger`SELECT pg_database_size(current_database())::float AS bytes`;
        return Number(size.bytes);
      })
    );
    ledgerBytes = sizes.reduce((total, value) => total + value, 0);
  } catch {
    /* A failed ledger probe is never reported healthy. */
  }
  const measured = volumes.map((volume) => ({
    name: volume.name,
    totalBytes: volume.totalBytes,
    usedBytes: volume.usedBytes,
    usedPercent: Number(volume.percent),
    sampledAt: volume.sampled_at.toISOString(),
    stale: volume.stale,
  }));
  const alerts = storageAlerts(measured);
  if (readiness.status !== "ready") {
    alerts.push("readiness_unavailable");
  }
  if (!backup[0]?.ready) {
    alerts.push("backup_unavailable");
  }
  if (walBytes === null) {
    alerts.push("wal_coverage_missing");
  }
  if (ledgerBytes === null) {
    alerts.push("ledger_unavailable");
  }
  if (pending[0].count) {
    alerts.push("deletion_pending");
  }
  if (email[0].failed || readiness.checks.email !== "ready") {
    alerts.push("email_unavailable");
  }
  return operationalMetricsSchema.parse({
    sampledAt: new Date().toISOString(),
    readiness,
    requests: requests[0],
    search: { ...search[0], ...lag },
    waitingPolls: polls[0].count,
    email: email[0],
    storage: { ...storage[0], walBytes, volumes: measured },
    backup: {
      status: backup[0]?.ready ? "ready" : "unavailable",
      checkpoint: backup[0]?.checkpoint.toISOString() ?? null,
      retentionOk: backup[0]?.retention_ok ?? false,
    },
    ledger: {
      status: ledgerBytes === null ? "unavailable" : "ready",
      bytes: ledgerBytes,
      pendingDeletions: pending[0].count,
    },
    errors,
    alerts,
  });
};

export const handleOperationalMetrics = async (request: Request) => {
  const headers = { "Cache-Control": "no-store" };
  try {
    const expected = Buffer.from(`Bearer ${secret("PR0_METRICS_SECRET")}`);
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return new Response(null, { status: 404, headers });
    }
  } catch {
    return new Response(null, { status: 404, headers });
  }
  try {
    return Response.json(await readOperationalMetrics(), { headers });
  } catch {
    return Response.json(
      { code: "unavailable" },
      { status: 503, headers: { ...headers, "Retry-After": "5" } }
    );
  }
};
