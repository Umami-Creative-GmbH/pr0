import "server-only";
import { AccountFailureError } from "./admission";
import { workDatabase } from "./database";
import { serviceLimit } from "./service-limits";

export const reservePoll = async (owner: string) => {
  const sql = workDatabase();
  const id = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(24060)`;
    await tx`DELETE FROM waiting_poll WHERE expires_at <= clock_timestamp()`;
    const [counts] = await tx`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE owner=${owner})::int AS account FROM waiting_poll`;
    if (
      counts.total >= serviceLimit("POLL_TOTAL", 100) ||
      counts.account >= serviceLimit("POLL_ACCOUNT", 4)
    ) {
      throw new AccountFailureError("unavailable", 503, 5);
    }
    // A poll waits at most 25 seconds; allow its final bounded database read.
    await tx`INSERT INTO waiting_poll VALUES (${id}, ${owner}, clock_timestamp() + interval '35 seconds')`;
  });
  return async () => {
    await sql`DELETE FROM waiting_poll WHERE id=${id}`;
  };
};
