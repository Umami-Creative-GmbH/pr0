import { database } from "../src/server/database";
import { deliverMail } from "../src/server/mail";

// oxlint-disable eslint/no-await-in-loop, eslint/no-unmodified-loop-condition -- Signal handlers stop this serial, bounded worker; parallel polling would defeat its concurrency limit.
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
while (running) {
  try {
    await deliverMail();
  } catch {
    process.stderr.write('{"event":"mail_worker_unavailable"}\n');
  }
  await Bun.sleep(1000);
}
await database().close();
