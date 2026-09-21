// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Admission polls are sequential and bounded by a five-second deadline.
import "server-only";
import { AccountFailureError } from "./admission";
import { workDatabase } from "./database";
import { ensureDeletionRecovery } from "./deletion-recovery";
import { ensureSchemaCompatibility } from "./schema-compatibility";

export const withRequestWork = async (
  operation: (claimOwner: (owner: string) => Promise<void>) => Promise<Response>
) => {
  await ensureSchemaCompatibility();
  await ensureDeletionRecovery();
  const sql = workDatabase();
  const id = crypto.randomUUID();
  const deadline = Date.now() + 5000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let renewing = false;
  let renewalFailed = false;
  try {
    let admitted = false;
    while (!admitted) {
      admitted = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(24005)`;
        await ensureSchemaCompatibility(tx);
        await tx`DELETE FROM request_work WHERE expires_at <= now()`;
        const [counts] =
          await tx`SELECT count(*) FILTER (WHERE active)::int AS active,
          count(*) FILTER (WHERE NOT active)::int AS queued FROM request_work`;
        if (counts.active < 16) {
          await tx`INSERT INTO request_work(id, active, expires_at) VALUES (${id}, true, now() + interval '30 seconds')
            ON CONFLICT(id) DO UPDATE SET active = true, expires_at = now() + interval '30 seconds'`;
          return true;
        }
        const existing = await tx`SELECT id FROM request_work WHERE id = ${id}`;
        if (!existing.length && counts.queued >= 64) {
          throw new AccountFailureError("unavailable", 503, 5);
        }
        await tx`INSERT INTO request_work(id, expires_at) VALUES (${id}, now() + interval '5 seconds') ON CONFLICT DO NOTHING`;
        return false;
      });
      if (!admitted) {
        if (Date.now() >= deadline) {
          throw new AccountFailureError("unavailable", 503, 5);
        }
        await Bun.sleep(50);
      }
    }
    timer = setInterval(() => {
      if (renewing) {
        return;
      }
      renewing = true;
      void (async () => {
        try {
          await sql`UPDATE request_work SET expires_at = now() + interval '30 seconds' WHERE id = ${id}`;
        } catch {
          renewalFailed = true;
        } finally {
          renewing = false;
        }
      })();
    }, 5000);
    return await operation(async (owner) => {
      if (renewalFailed) {
        throw new AccountFailureError("unavailable", 503, 5);
      }
      await sql.begin(async (tx) => {
        const [account] =
          await tx`SELECT id FROM "user" WHERE id=${owner} AND NOT deletion_pending`;
        if (!account) {
          throw new AccountFailureError("unauthenticated", 401);
        }
        await tx`SELECT pg_advisory_xact_lock(24005)`;
        const [counts] =
          await tx`SELECT count(*)::int AS count FROM request_work WHERE active AND owner = ${owner}`;
        if (counts.count >= 4) {
          throw new AccountFailureError("unavailable", 503, 5);
        }
        await tx`UPDATE request_work SET owner = ${owner} WHERE id = ${id}`;
      });
    });
  } finally {
    clearInterval(timer);
    await sql`DELETE FROM request_work WHERE id = ${id}`;
  }
};
