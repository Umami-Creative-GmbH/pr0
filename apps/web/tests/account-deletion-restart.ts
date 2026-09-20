import { deletionTrustSchema } from "@pr0/api-contract/deletions";
// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each durable boundary is interrupted and recovered before the next scenario.
import { SQL } from "bun";

import { runAcceptance } from "./account-test-server";
import { freshSocialBrowser } from "./email-change-fixture";
import { origin, post } from "./http-fixture";

const stages = [
  "barrier",
  "intent-a",
  "intent-b",
  "purge",
  "receipt-a",
  "receipt-b",
  "completion",
] as const;
export const deletionRestartScenarios = async (server: {
  stopServer: () => Promise<void>;
  startServer: () => Promise<void>;
}) => {
  const app = new SQL(process.env.DATABASE_URL ?? "");
  const a = new SQL(process.env.PR0_LEDGER_A_URL ?? "");
  const b = new SQL(process.env.PR0_LEDGER_B_URL ?? "");
  try {
    for (const stage of stages) {
      const account = await freshSocialBrowser();
      const response = await fetch(`${origin}/api/v1/account/deletion`, {
        headers: { Cookie: account.Cookie },
      });
      const trust = deletionTrustSchema.parse(await response.json());
      const ledgerStage = stage.includes("-");
      const store = stage.endsWith("-a") ? a : b;
      const control = ledgerStage ? store : app;
      await control`CREATE TABLE fixture_deletion_failure (target text PRIMARY KEY)`;
      const target = ledgerStage
        ? `${stage.startsWith("intent") ? "intent" : "receipt"}:${stage.startsWith("intent") ? account.identity.accountId : trust.handle}`
        : account.identity.accountId;
      await control`INSERT INTO fixture_deletion_failure VALUES (${target})`;
      let table = "account_deletion_pending";
      let column = `${stage === "completion" ? "OLD" : "NEW"}.account_id`;
      if (ledgerStage) {
        table = "deletion_record";
        column = "NEW.id";
      } else if (stage === "purge") {
        table = '"user"';
        column = "OLD.id";
      }
      const timing =
        stage === "purge" || stage === "completion" ? "DELETE" : "INSERT";
      await control.unsafe(`CREATE FUNCTION fixture_deletion_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF EXISTS(SELECT 1 FROM fixture_deletion_failure WHERE target=${column}) THEN RAISE EXCEPTION 'controlled durable boundary failure'; END IF;
        RETURN ${timing === "DELETE" ? "OLD" : "NEW"}; END; $$;
        CREATE TRIGGER fixture_deletion_failure BEFORE ${timing} ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_deletion_failure();`);
      try {
        const deletion = await post(
          "/api/v1/account/deletion",
          { ...account.identity, confirmation: "delete-account" },
          { Cookie: account.Cookie }
        );
        // Preserve the actual public result across process termination; assertions run as tests below.
        const initial = {
          status: deletion.status,
          body: await deletion.json(),
        };
        await server.stopServer();
        await control.unsafe(
          `DROP TRIGGER fixture_deletion_failure ON ${table}; DROP FUNCTION fixture_deletion_failure(); DROP TABLE fixture_deletion_failure;`
        );
        await server.startServer();
        await runAcceptance(
          ["bun", "test", "apps/web/tests/account-deletion-restart.test.ts"],
          {
            PR0_DELETION_RESTART: JSON.stringify({
              stage,
              Cookie: account.Cookie,
              trust,
              initial,
            }),
          }
        );
      } finally {
        await control.unsafe(
          `DROP TRIGGER IF EXISTS fixture_deletion_failure ON ${table}; DROP FUNCTION IF EXISTS fixture_deletion_failure(); DROP TABLE IF EXISTS fixture_deletion_failure;`
        );
      }
    }
  } finally {
    await Promise.all([app.close(), a.close(), b.close()]);
  }
};
