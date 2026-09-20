import "server-only";
import { database } from "./database";
import { resumeDeletions } from "./deletion-coordinator";

let startup: Promise<void> | undefined;
let running = false;
let worker: ReturnType<typeof setInterval> | undefined;
export const ensureDeletionRecovery = async () => {
  const configured =
    process.env.PR0_LEDGER_A_URL ||
    process.env.PR0_LEDGER_A_URL_FILE ||
    process.env.PR0_LEDGER_B_URL ||
    process.env.PR0_LEDGER_B_URL_FILE;
  if (!configured) {
    const [instance] = await database()`SELECT deletion_anchor FROM instance`;
    if (instance?.deletion_anchor) {
      throw new Error("Independent deletion ledger configuration is required");
    }
    return;
  }
  startup ??= resumeDeletions();
  try {
    await startup;
  } catch (error) {
    startup = undefined;
    throw error;
  }
  worker ??= setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void (async () => {
      try {
        await resumeDeletions(false);
      } catch {
        // Requests keep their pending status; no success or completion is invented.
      } finally {
        running = false;
      }
    })();
  }, 5000);
  worker.unref();
};
