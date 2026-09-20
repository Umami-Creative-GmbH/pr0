import type { librarySchema } from "@pr0/api-contract/accounts";
// oxlint-disable react-doctor/server-sequential-independent-await -- This seeds pre-existing data under the library lock; observations use public REST/native commands.
import { SQL } from "bun";
import type { z } from "zod";

export const seedDownloadCapacity = async (
  library: z.infer<typeof librarySchema>
) => {
  const url = process.env.DATABASE_URL;
  if (url !== "postgres://pr0:local-social-test-only@localhost:55439/pr0") {
    throw new Error(
      "Snapshot capacity fixture requires isolated test database"
    );
  }
  const sql = new SQL(url);
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT account_id FROM library WHERE account_id=${library.account.id} FOR UPDATE`;
      await tx`INSERT INTO prompt(instance_id,account_id,id,title,description,content,revision,title_revision,description_revision,content_revision,created_at,modified_at)
        SELECT ${library.instance.id}::uuid,${library.account.id},gen_random_uuid(),'Capacity','',repeat('x',CASE WHEN n<=7600 THEN 10478 ELSE 10477 END),n,n,n,n,date_trunc('milliseconds',now()),date_trunc('milliseconds',now()) FROM generate_series(1,10000) n`;
      await tx`UPDATE library SET revision=10000,prompt_count=10000,text_bytes=104857600 WHERE account_id=${library.account.id}`;
    });
  } finally {
    await sql.close();
  }
};
