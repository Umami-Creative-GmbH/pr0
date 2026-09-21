import { statfsSync } from "node:fs";

import { storageNameSchema } from "@pr0/api-contract/operations";
import { z } from "zod";

import { database } from "../src/server/database";
import { readOperationalMetrics } from "../src/server/operational-metrics";

const [command, name, value] = process.argv.slice(2);
const sql = database();
try {
  if (command === "sample-storage") {
    const volume = storageNameSchema.parse(name);
    const space = statfsSync(z.string().min(1).parse(value));
    const total = space.blocks * space.bsize;
    const used = (space.blocks - space.bavail) * space.bsize;
    await sql`INSERT INTO storage_observation(name,total_bytes,used_bytes,sampled_at) VALUES (${volume},${total},${used},clock_timestamp())
      ON CONFLICT(name) DO UPDATE SET total_bytes=excluded.total_bytes,used_bytes=excluded.used_bytes,sampled_at=excluded.sampled_at`;
    process.stdout.write(
      `${JSON.stringify({ event: "storage_sampled", name: volume, usedPercent: (100 * used) / total })}\n`
    );
  } else if (command === "record-backup") {
    const checkpoint = z.iso.datetime().parse(name);
    if (Date.parse(checkpoint) > Date.now()) {
      throw new Error("Checkpoint cannot be in the future");
    }
    const retention = z.enum(["retention-ok", "retention-failed"]).parse(value);
    await sql`INSERT INTO backup_observation(checkpoint,retention_ok,verified_at) VALUES (${checkpoint},${retention === "retention-ok"},clock_timestamp())
      ON CONFLICT(singleton) DO UPDATE SET checkpoint=excluded.checkpoint,retention_ok=excluded.retention_ok,verified_at=excluded.verified_at`;
    process.stdout.write('{"event":"backup_observation_recorded"}\n');
  } else if (command === "metrics") {
    const metrics = await readOperationalMetrics();
    process.stdout.write(`${JSON.stringify(metrics)}\n`);
    if (metrics.alerts.length) {
      process.exitCode = 1;
    }
  } else {
    throw new Error(
      "Use sample-storage <database|search|ledger-a|ledger-b|backup> <mounted-path>, record-backup <verified-checkpoint-UTC> <retention-ok|retention-failed>, or metrics"
    );
  }
} catch {
  process.stderr.write('{"event":"operations_command_failed"}\n');
  process.exitCode = 1;
} finally {
  await sql.close();
  // The command may open independent ledger and monitoring pools.
  process.exit(process.exitCode ?? 0);
}
