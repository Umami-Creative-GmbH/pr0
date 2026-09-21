import { configuration } from "../src/server/config";
import { database } from "../src/server/database";
import { migrate } from "./migrate";

const sql = database();
const [command] = process.argv.slice(2);
try {
  configuration();
  if (command === "migrate") {
    await migrate(sql);
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
  } else if (
    command === "pause-registration" ||
    command === "resume-registration"
  ) {
    await sql`UPDATE instance SET registration_paused=${command === "pause-registration"}`;
    process.stdout.write(
      "Registration admission updated; existing-account recovery remains available.\n"
    );
  } else if (command === "suspend" || command === "resume") {
    const { z } = await import("zod");
    const accountId = z.uuid().parse(process.argv[3]);
    const rows =
      await sql`UPDATE "user" SET suspended=${command === "suspend"} WHERE id=${accountId} RETURNING id`;
    if (!rows.length) {
      throw new Error("Account not found");
    }
    process.stdout.write(
      "Account admission updated; retained work is unchanged.\n"
    );
  } else if (command === "mail-status") {
    const rows =
      await sql`SELECT state, count(*)::int AS count FROM mail_job GROUP BY state`;
    process.stdout.write(`${JSON.stringify(rows)}\n`);
  } else {
    throw new Error(
      "Use migrate, admit-first <email>, allow <email>, pause-registration, resume-registration, suspend <account-uuid>, resume <account-uuid>, or mail-status"
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
