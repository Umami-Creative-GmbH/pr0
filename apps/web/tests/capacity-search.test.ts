// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Observe full REST pagination before and after acknowledged edits.
import { expect, test } from "bun:test";

import { SQL } from "bun";

import { capacityId } from "./capacity-corpus";
import { promptBrowser, promptClient, promptEdit } from "./prompt-fixture";

test("dense short-query membership stays exact through public edits and complete later pages", async () => {
  const account = await promptBrowser();
  if (
    process.env.DATABASE_URL !==
    "postgres://pr0:local-social-test-only@localhost:55426/pr0"
  ) {
    throw new Error("Requires isolated search fixture database");
  }
  const sql = new SQL(process.env.DATABASE_URL);
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT account_id FROM library WHERE account_id=${account.identity.accountId} FOR UPDATE`;
      await tx`INSERT INTO prompt(instance_id,account_id,id,title,description,content,revision,title_revision,description_revision,content_revision,created_at,modified_at)
        SELECT ${account.identity.instanceId}::uuid,${account.identity.accountId},('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Entry '||lpad(n::text,4,'0'),'',CASE WHEN n%2=0 THEN 'qx 🎯' ELSE 'zx 🫠' END,n+1,n+1,n+1,n+1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z' FROM generate_series(0,1999) n`;
      await tx`INSERT INTO library_operation(instance_id,account_id,operation_id,epoch,installation_id,canonical_version,request_hash,kind,prompt_id,revision,accepted_at)
        SELECT instance_id,account_id,gen_random_uuid(),${account.identity.epoch}::uuid,${account.identity.installationId}::uuid,1,'capacity-fixture','prompt.create',id,revision,created_at FROM prompt WHERE account_id=${account.identity.accountId}`;
      await tx`INSERT INTO library_change(instance_id,account_id,revision,operation_id,kind,prompt_id,accepted_at)
        SELECT instance_id,account_id,revision,operation_id,kind,prompt_id,accepted_at FROM library_operation WHERE account_id=${account.identity.accountId}`;
      await tx`UPDATE library SET revision=2000,prompt_count=2000,text_bytes=(SELECT sum(octet_length(title)+octet_length(description)+octet_length(content)) FROM prompt WHERE account_id=${account.identity.accountId}) WHERE account_id=${account.identity.accountId}`;
    });
  } finally {
    await sql.close();
  }
  const client = promptClient(account.Cookie);
  const initial = await client.getPrompts({ query: "qx", limit: 100 });
  expect(initial.prompts).toHaveLength(100);
  for (const [index, content] of [
    [0, "zx 🫠"],
    [1, "qx 🎯"],
  ] as const) {
    const prompt = await client.getPrompt(capacityId(index));
    await client.mutatePrompts({
      ...account.identity,
      operations: [
        promptEdit(prompt, { title: prompt.title, description: "", content }),
      ],
    });
  }
  const expected = Array.from({ length: 999 }, (_, index) =>
    capacityId((index + 1) * 2)
  );
  expected.push(capacityId(1));
  expected.sort();
  for (const query of ["q", "qx", "🎯"]) {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.getPrompts({ query, limit: 100, cursor });
      ids.push(...page.prompts.map((prompt) => prompt.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    ids.sort();
    expect(ids).toEqual(expected);
  }
}, 120_000);
