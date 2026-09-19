import { configuration } from "../src/server/config";
import { database } from "../src/server/database";

const sql = database();
const [command] = process.argv.slice(2);
try {
  configuration();
  if (command === "migrate") {
    const migrations = await Promise.all(
      [
        "001-accounts.sql",
        "002-request-work.sql",
        "003-email-admission.sql",
        "004-session-issuance.sql",
        "005-social.sql",
      ].map(async (name, index) => ({
        version: index + 1,
        source: await Bun.file(
          new URL(`../migrations/${name}`, import.meta.url)
        ).text(),
      }))
    );
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(24001)`;
      await tx`CREATE TABLE IF NOT EXISTS migration (version integer PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
      // oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Versioned DDL must apply sequentially under the coordinator lock.
      for (const migration of migrations) {
        const digest = new Bun.CryptoHasher("sha256")
          .update(migration.source)
          .digest("hex");
        const applied =
          await tx`SELECT digest FROM migration WHERE version = ${migration.version}`;
        if (applied.length > 0) {
          if (applied[0].digest !== digest) {
            throw new Error("Applied migration checksum mismatch");
          }
        } else {
          await tx.unsafe(migration.source);
          if (migration.version === 1) {
            await tx`INSERT INTO instance(id, schema_version) VALUES (${crypto.randomUUID()}, 1)`;
          }
          await tx`INSERT INTO migration(version, digest) VALUES (${migration.version}, ${digest})`;
        }
      }
    });
    process.stdout.write(
      "Account schema ready; immutable instance identity retained.\n"
    );
  } else if (command === "admit-first" || command === "allow") {
    if (command === "allow" && configuration().registration !== "allowlist") {
      throw new Error("Use allow only with PR0_REGISTRATION=allowlist");
    }
    const { emailSchema } = await import("@pr0/api-contract/accounts");
    const email = emailSchema.parse(process.argv[3]);
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(24002)`;
      if (command === "admit-first") {
        const accounts = await tx`SELECT id FROM "user" LIMIT 1`;
        const admissions =
          await tx`SELECT email FROM registration_admission LIMIT 1`;
        if (accounts.length || admissions.length) {
          throw new Error(
            "First-account admission already used; use allow with allowlist mode"
          );
        }
      }
      await tx`INSERT INTO registration_admission(email, first_account) VALUES (${email}, ${command === "admit-first"}) ON CONFLICT DO NOTHING`;
    });
    process.stdout.write(
      "Address admitted; ordinary signup and email verification are still required.\n"
    );
  } else if (command === "mail-status") {
    const rows =
      await sql`SELECT state, count(*)::int AS count FROM mail_job GROUP BY state`;
    process.stdout.write(`${JSON.stringify(rows)}\n`);
  } else {
    throw new Error(
      "Use migrate, admit-first <email>, allow <email>, or mail-status"
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Account command failed"}\n`
  );
  process.exitCode = 1;
} finally {
  await sql.close();
}
