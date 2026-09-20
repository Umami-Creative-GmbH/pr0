import { SQL } from "bun";

// Fault injection at the external persistence boundary; verification remains through REST.
export const withConflictStorageFailure = async (
  check: () => Promise<void>
) => {
  const url = process.env.DATABASE_URL;
  if (url !== "postgres://pr0:local-social-test-only@localhost:55426/pr0") {
    throw new Error(
      "Storage fault fixture requires the isolated local test database"
    );
  }
  const sql = new SQL(url);
  try {
    await sql.unsafe(
      "CREATE FUNCTION fail_conflict_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected storage failure'; END $$; CREATE TRIGGER fail_conflict_fixture BEFORE INSERT ON conflict_notice FOR EACH ROW EXECUTE FUNCTION fail_conflict_fixture();"
    );
    await check();
  } finally {
    await sql.unsafe(
      "DROP TRIGGER IF EXISTS fail_conflict_fixture ON conflict_notice; DROP FUNCTION IF EXISTS fail_conflict_fixture();"
    );
    await sql.close();
  }
};
