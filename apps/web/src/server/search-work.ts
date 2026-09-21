// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Queue admission polls a bounded deadline; active advisory locks span exactly one worker job.
import "server-only";
import { AccountFailureError } from "./admission";
import { searchDatabase, workDatabase } from "./database";
import { serviceLimit } from "./service-limits";

export const withSearchWork = async <T>(
  owner: string,
  signal: AbortSignal,
  operation: () => Promise<T>
): Promise<T> => {
  const sql = workDatabase();
  const id = crypto.randomUUID();
  const deadline = Date.now() + serviceLimit("SEARCH_QUEUE_MS", 2000);
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(24061)`;
    await tx`DELETE FROM search_work WHERE expires_at <= clock_timestamp()`;
    const [counts] =
      await tx`SELECT count(*)::int AS count FROM search_work WHERE NOT active`;
    if (counts.count >= serviceLimit("SEARCH_QUEUE", 32)) {
      throw new AccountFailureError("unavailable", 503, 2);
    }
    await tx`INSERT INTO search_work(id,owner,expires_at) VALUES (${id},${owner},${new Date(deadline)})`;
  });
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const attempt = await searchDatabase().begin(async (tx) => {
        if (Date.now() >= deadline) {
          throw new AccountFailureError("unavailable", 503, 2);
        }
        const [account] =
          await tx`SELECT pg_try_advisory_xact_lock(hashtextextended(${owner},60)) AS acquired`;
        if (!account.acquired) {
          return;
        }
        // Two dedicated connections/locks bound actual workers across all web processes.
        const [slot] =
          await tx`SELECT pg_try_advisory_xact_lock(24062,0) AS acquired`;
        if (!slot.acquired) {
          const [second] =
            await tx`SELECT pg_try_advisory_xact_lock(24062,1) AS acquired`;
          if (!second.acquired) {
            return;
          }
        }
        signal.throwIfAborted();
        await sql`UPDATE search_work SET active=true, expires_at=clock_timestamp()+interval '5 minutes' WHERE id=${id}`;
        return { result: await operation() };
      });
      if (attempt) {
        return attempt.result;
      }
      await Bun.sleep(25);
    }
    throw new AccountFailureError("unavailable", 503, 2);
  } finally {
    await sql`DELETE FROM search_work WHERE id=${id}`;
  }
};
