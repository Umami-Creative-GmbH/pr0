import type { LibraryScope } from "@pr0/api-contract/prompts";
// oxlint-disable react-doctor/server-sequential-independent-await -- External fixtures establish persisted state; assertions use REST.
import { SQL } from "bun";

const fixtureDatabase = () => {
  const url = process.env.DATABASE_URL;
  if (
    url !== "postgres://pr0:local-social-test-only@localhost:55426/pr0" &&
    url !== "postgres://pr0:local-deletion-test-only@localhost:55456/pr0"
  ) {
    throw new Error("Organization fixture requires the isolated test database");
  }
  return new SQL(url);
};
export const withOrganizationStorageFailure = async (
  check: () => Promise<void>
) => {
  const sql = fixtureDatabase();
  try {
    await sql.unsafe(
      "CREATE FUNCTION fail_organization_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_effect IS NOT NULL THEN RAISE EXCEPTION 'Injected storage failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_organization_fixture BEFORE INSERT ON library_change FOR EACH ROW EXECUTE FUNCTION fail_organization_fixture();"
    );
    await check();
  } finally {
    await sql.unsafe(
      "DROP TRIGGER IF EXISTS fail_organization_fixture ON library_change; DROP FUNCTION IF EXISTS fail_organization_fixture();"
    );
    await sql.close();
  }
};
export const seedOrganizationCapacity = async (
  scope: LibraryScope,
  tagId: string
) => {
  const sql = fixtureDatabase();
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT account_id FROM library WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} FOR UPDATE`;
      await tx`INSERT INTO prompt(instance_id, account_id, id, title, description, content, revision, title_revision, description_revision, content_revision, created_at, modified_at, archived)
        SELECT ${scope.instanceId}::uuid, ${scope.accountId}, gen_random_uuid(), 'Capacity prompt ' || n, '', 'Kept', n + 100, n + 100, n + 100, n + 100, date_trunc('milliseconds', now()), date_trunc('milliseconds', now()), n % 2 = 0 FROM generate_series(1, 10000) n`;
      await tx`INSERT INTO prompt_tag(instance_id, account_id, prompt_id, tag_id, add_revision) SELECT instance_id, account_id, id, ${tagId}::uuid, revision FROM prompt WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId}`;
      await tx`UPDATE library SET revision = 10100, prompt_count = 10000, text_bytes = text_bytes + (SELECT sum(octet_length(title) + octet_length(content)) FROM prompt WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId}) WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId}`;
    });
  } finally {
    await sql.close();
  }
};
