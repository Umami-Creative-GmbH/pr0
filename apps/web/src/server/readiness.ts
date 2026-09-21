import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

import { readinessResponseSchema } from "@pr0/api-contract/health";
import type { ReadinessResponse } from "@pr0/api-contract/health";

import { configuration } from "./config";
import { database } from "./database";
import { readEvidence } from "./deletion-ledger";
import { ensureDeletionRecovery } from "./deletion-recovery";
import { validateMailConfiguration } from "./mail";
import { ensureSchemaCompatibility } from "./schema-compatibility";
import { searchFileSignature } from "./search-location";

export const readReadiness = async (): Promise<ReadinessResponse> => {
  const checks: ReadinessResponse["checks"] = {
    schema: "unavailable",
    deletionReplay: "unavailable",
    email: "unavailable",
    search: "unavailable",
  };
  try {
    await ensureSchemaCompatibility();
    configuration();
    const sql = database();
    const [instance] =
      await sql`SELECT id,deletion_anchor FROM instance WHERE schema_version=6
      AND EXISTS(SELECT 1 FROM migration WHERE version=19)`;
    if (!instance) {
      return { status: "unavailable", checks };
    }
    checks.schema = "ready";
    await ensureDeletionRecovery();
    if (instance.deletion_anchor) {
      await readEvidence(instance.id, "health");
    }
    checks.deletionReplay = "ready";
    const search = await sql<
      { account_id: string; current: boolean; file_signature: string | null }[]
    >`SELECT l.account_id,h.file_signature,
      COALESCE(h.revision>=l.revision AND h.epoch=i.recovery_epoch,false) AS current FROM library l CROSS JOIN instance i
      LEFT JOIN search_projection_health h ON h.account_id=l.account_id
      WHERE l.revision>0`;
    if (existsSync(path.resolve(".operations/search-worker.js"))) {
      checks.search = search.every(
        (projection) =>
          projection.current &&
          projection.file_signature !== null &&
          projection.file_signature ===
            searchFileSignature(instance.id, projection.account_id)
      )
        ? "ready"
        : "search_preparing";
    }
    validateMailConfiguration();
    const [mail] =
      await sql`SELECT name FROM worker_health WHERE name='mail' AND heartbeat_at>clock_timestamp()-interval '30 seconds'`;
    checks.email = mail ? "ready" : "unavailable";
  } catch {
    // Keep completed checks; never expose configuration, SQL or credentials.
  }
  return readinessResponseSchema.parse({
    status: Object.values(checks).every((value) => value === "ready")
      ? "ready"
      : "unavailable",
    checks,
  });
};

export const handleReadiness = async () => {
  const body = await readReadiness();
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (body.status !== "ready") {
    headers.set("Retry-After", "5");
  }
  return Response.json(body, {
    status: body.status === "ready" ? 200 : 503,
    headers,
  });
};
