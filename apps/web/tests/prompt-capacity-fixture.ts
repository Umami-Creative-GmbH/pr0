import type { MutationEnvelope } from "@pr0/api-contract/prompts";
// oxlint-disable react-doctor/server-sequential-independent-await -- Seed a complete existing library transaction, then exercise changes only through REST.
import { SQL } from "bun";

export const seedCapacity = async (
  identity: Omit<MutationEnvelope, "operations">,
  resource: "promptCount" | "textBytes"
) => {
  const url = process.env.DATABASE_URL;
  if (
    url !== "postgres://pr0:local-social-test-only@localhost:55426/pr0" &&
    url !== "postgres://pr0:local-deletion-test-only@localhost:55456/pr0"
  ) {
    throw new Error(
      "Capacity fixture requires the isolated local test database"
    );
  }
  const sql = new SQL(url);
  const count = resource === "promptCount" ? 9999 : 400;
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT account_id FROM library WHERE account_id = ${identity.accountId} FOR UPDATE`;
      await tx`INSERT INTO prompt(instance_id, account_id, id, title, description, content, revision, title_revision, description_revision, content_revision, created_at, modified_at)
        SELECT ${identity.instanceId}::uuid, ${identity.accountId}, gen_random_uuid(), 'p', '',
          CASE WHEN ${resource} = 'promptCount' THEN 'x' ELSE repeat('x', CASE WHEN n = 400 THEN 262141 ELSE 262143 END) END,
          n, n, n, n, date_trunc('milliseconds', now()), date_trunc('milliseconds', now()) FROM generate_series(1, ${count}::int) n`;
      await tx`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at)
        SELECT instance_id, account_id, gen_random_uuid(), ${identity.epoch}::uuid, ${identity.installationId}::uuid, 1, 'capacity-fixture', 'prompt.create', id, revision, created_at FROM prompt WHERE account_id = ${identity.accountId}`;
      await tx`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at)
        SELECT instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at FROM library_operation WHERE account_id = ${identity.accountId}`;
      await tx`UPDATE library SET revision = ${count}, prompt_count = ${count}, text_bytes = (SELECT sum(octet_length(title) + octet_length(description) + octet_length(content)) FROM prompt WHERE account_id = ${identity.accountId}) WHERE account_id = ${identity.accountId}`;
    });
  } finally {
    await sql.close();
  }
};
