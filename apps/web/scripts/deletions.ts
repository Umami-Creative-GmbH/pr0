import { database } from "../src/server/database";
import {
  deletionInstance,
  resumeDeletions,
} from "../src/server/deletion-coordinator";
import {
  closeLedgerStores,
  initializeLedgerStores,
} from "../src/server/deletion-ledger";
import {
  initializeSigningKey,
  rotateSigningKey,
} from "../src/server/deletion-signing";

const [command] = process.argv.slice(2);
try {
  const instanceId = await deletionInstance();
  if (command === "initialize") {
    await initializeLedgerStores();
    await initializeSigningKey(instanceId);
  } else if (command === "rotate") {
    await rotateSigningKey(instanceId);
  } else if (command === "replay") {
    await resumeDeletions();
  } else {
    throw new Error("Use initialize, rotate, or replay");
  }
  process.stdout.write("Deletion evidence operation completed.\n");
} catch {
  process.stderr.write(
    "Deletion evidence unavailable or inconsistent; keep service closed and retry.\n"
  );
  process.exitCode = 1;
} finally {
  await closeLedgerStores();
  await database().close();
}
