import "server-only";
import { database } from "./database";

let worker: ReturnType<typeof setInterval> | undefined;
let running = false;
export const startChangeRetention = () => {
  worker ??= setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void (async () => {
      try {
        // Independent replicas skip one another's batches; no account activity is required.
        await database()`DELETE FROM library_change WHERE ctid IN (
          SELECT ctid FROM library_change WHERE accepted_at < clock_timestamp() - interval '90 days'
          ORDER BY accepted_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
      } catch {
        process.stderr.write('{"event":"change_retention_unavailable"}\n');
      } finally {
        running = false;
      }
    })();
  }, 10_000);
  worker.unref();
};
