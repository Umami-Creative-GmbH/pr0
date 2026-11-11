// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each re-deletion commits in its own transaction, in log order.
import { logAccountDeletion, purgeAccount } from "../src/server/account-purge";
import { database } from "../src/server/database";
import { deletionsFromLog } from "./deletion-log";

if (import.meta.main) {
  const [command] = process.argv.slice(2);
  const sql = database();
  try {
    if (command !== "reapply") {
      throw new Error("Use reapply < deletion-log");
    }
    const deletions = deletionsFromLog(await Bun.stdin.text());
    let purged = 0;
    for (const { accountId, deletedAt } of deletions) {
      const deletion = await sql.begin((tx) =>
        purgeAccount(tx, accountId, deletedAt)
      );
      if (deletion.purged) {
        purged += 1;
        logAccountDeletion(deletion, "account_redeleted");
      }
    }
    process.stdout.write(
      `${JSON.stringify({ event: "deletions_reapplied", read: deletions.length, purged })}\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Re-deletion failed"}; keep ingress closed and retry.\n`
    );
    process.exitCode = 1;
  } finally {
    await sql.close();
  }
}
