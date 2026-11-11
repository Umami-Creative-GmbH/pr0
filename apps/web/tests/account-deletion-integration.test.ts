// oxlint-disable unicorn/no-await-expression-member, eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Sequential public HTTP scenarios and bounded recovery polling preserve the external failure order.
import { expect, test } from "bun:test";

import {
  deletionIdentitySchema,
  deletionResultSchema,
} from "@pr0/api-contract/deletions";
import { SQL } from "bun";

import { freshSocialBrowser, socialBrowser } from "./email-change-fixture";
import { origin, post, cookieFrom } from "./http-fixture";
import { promptClient, promptOperation } from "./prompt-fixture";
import { githubLogin, libraryFor } from "./social-fixture";

test("account deletion requires fresh browser authentication and explicit confirmation", async () => {
  const browser = await socialBrowser();
  const response = await post(
    "/api/v1/account/deletion",
    {
      ...browser.identity,
      confirmation: "delete-account",
    },
    { Cookie: browser.Cookie }
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: "fresh_auth_required" });
  const direct = await post(
    "/api/auth/delete-user",
    {},
    { Cookie: browser.Cookie }
  );
  expect(direct.status).toBe(404);
});

test("confirmation, identity, expired proof, device provenance and cross-origin requests cannot bypass deletion guards", async () => {
  const account = await freshSocialBrowser();
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  const headers = { Cookie: account.Cookie };
  const input = { ...account.identity, confirmation: "delete-account" };
  try {
    expect(
      (await post("/api/v1/account/deletion", account.identity, headers)).status
    ).toBe(400);
    expect(
      (
        await post(
          "/api/v1/account/deletion",
          { ...input, accountId: crypto.randomUUID() },
          headers
        )
      ).status
    ).toBe(409);
    expect(
      (
        await post("/api/v1/account/deletion", input, {
          ...headers,
          Origin: "https://attacker.example",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await post("/api/v1/account/deletion", input, {
          ...headers,
          Authorization: "Bearer arbitrary",
        })
      ).status
    ).toBe(403);
    await sql`UPDATE fresh_auth SET expires_at=clock_timestamp()-interval '1 second' WHERE session_id=${account.sessionId}`;
    await libraryFor(account.Cookie);
    expect(
      await (await post("/api/v1/account/deletion", input, headers)).json()
    ).toEqual({ code: "fresh_auth_required" });
    await sql`UPDATE session SET provenance='device' WHERE id=${account.sessionId}`;
    expect(
      (await post("/api/v1/account/deletion", input, headers)).status
    ).toBe(403);
  } finally {
    await sql.close();
  }
});

test("concurrent mutations cannot survive deletion and same-email recreation receives a new empty library", async () => {
  const account = await freshSocialBrowser();
  const other = await socialBrowser();
  const old = await libraryFor(account.Cookie);
  const create = promptOperation({
    title: "Private deletion fixture",
    description: "",
    content: `private-${crypto.randomUUID()}`,
  });
  const envelope = {
    protocolVersion: 1 as const,
    instanceId: old.instance.id,
    accountId: old.account.id,
    epoch: old.epoch,
    installationId: crypto.randomUUID(),
    operations: [create],
  };
  const first = await promptClient(account.Cookie).mutatePrompts(envelope);
  expect(first.results[0]?.status).toBe("accepted");
  await promptClient(account.Cookie).getPrompts();
  const concurrent = await Promise.all([
    post(
      "/api/v1/account/deletion",
      { ...account.identity, confirmation: "delete-account" },
      { Cookie: account.Cookie }
    ),
    post(
      "/api/v1/sync/mutations",
      { ...envelope, operations: [promptOperation()] },
      { Cookie: account.Cookie }
    ),
  ]);
  expect(concurrent[0]?.status).toBe(200);
  // The operational backup boundary must contain no live account/session/prompt data.
  const backup = Bun.spawn(
    [
      "docker",
      "compose",
      "-p",
      "pr0-deletion-56",
      "-f",
      "apps/web/tests/account-deletion-compose.yaml",
      "exec",
      "-T",
      "database",
      "pg_dump",
      "-U",
      "pr0",
      "--data-only",
      "pr0",
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  // Only the tombstone may still name the account: drop its COPY section.
  const exported = (await new Response(backup.stdout).text())
    .split("COPY ")
    .filter((section) => !section.startsWith("public.deleted_accounts "))
    .join("COPY ");
  expect(await backup.exited).toBe(0);
  expect(exported).not.toContain(account.identity.accountId);
  expect(exported).not.toContain(account.email);
  expect(exported).not.toContain(create.desired.content);
  expect(exported).not.toContain(account.sessionId);
  expect(exported).toContain(other.identity.accountId);
  const late = await post("/api/v1/sync/mutations", envelope, {
    Cookie: account.Cookie,
  });
  expect(late.status).toBe(401);
  expect((await libraryFor(other.Cookie)).account.id).toBe(
    other.identity.accountId
  );
  const replacement = cookieFrom(
    await githubLogin(crypto.randomUUID(), account.email)
  );
  const current = await libraryFor(replacement);
  expect(current.account.id).not.toBe(old.account.id);
  expect((await promptClient(replacement).getPrompts()).prompts).toHaveLength(
    0
  );
  const replay = await post("/api/v1/sync/mutations", envelope, {
    Cookie: replacement,
  });
  expect(JSON.stringify(await replay.json())).not.toContain(
    '"status":"accepted"'
  );
});

test("confirmed deletion leaves only an opaque tombstone and answers the status lookup", async () => {
  const browser = await freshSocialBrowser();
  const setup = await fetch(`${origin}/api/v1/account/deletion`, {
    headers: { Cookie: browser.Cookie },
  });
  expect(setup.status).toBe(200);
  expect(setup.headers.get("cache-control")).toBe("no-store");
  const identity = deletionIdentitySchema.parse(await setup.json());
  expect(identity.accountId).toBe(browser.identity.accountId);
  const before = await fetch(
    `${origin}/api/v1/account-deletions/${identity.handle}`
  );
  expect(await before.json()).toEqual({ status: "absent" });
  const response = await post(
    "/api/v1/account/deletion",
    { ...browser.identity, confirmation: "delete-account" },
    { Cookie: browser.Cookie }
  );
  expect(response.status).toBe(200);
  const result = deletionResultSchema.parse(await response.json());
  expect(result).toEqual({
    status: "deleted",
    accountId: browser.identity.accountId,
    deletedAt: expect.any(String),
  });
  const lookup = await fetch(
    `${origin}/api/v1/account-deletions/${identity.handle}`
  );
  expect(lookup.headers.get("cache-control")).toBe("no-store");
  expect(await lookup.json()).toEqual(result);
  expect(
    (await fetch(`${origin}/api/v1/account-deletions/not-a-handle`)).status
  ).toBe(400);
  expect(
    (await fetch(`${origin}/api/v1/account-deletions/verification`)).status
  ).toBe(400);
  const library = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: browser.Cookie },
  });
  expect(library.status).toBe(401);
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  try {
    const columns =
      await sql`SELECT column_name FROM information_schema.columns WHERE table_name='deleted_accounts' ORDER BY column_name`;
    expect(
      columns.map((row: { column_name: string }) => row.column_name)
    ).toEqual(["account_id", "deleted_at", "handle"]);
    const [tombstone] =
      await sql`SELECT handle,deleted_at FROM deleted_accounts WHERE account_id=${identity.accountId}`;
    expect(tombstone.handle).toBe(identity.handle);
    expect(new Date(tombstone.deleted_at).toISOString()).toBe(result.deletedAt);
    const [live] = await sql`SELECT
      (SELECT count(*) FROM "user" WHERE id=${identity.accountId})::int AS users,
      (SELECT count(*) FROM session WHERE user_id=${identity.accountId})::int AS sessions,
      (SELECT count(*) FROM library WHERE account_id=${identity.accountId})::int AS libraries`;
    expect(live).toEqual({ users: 0, sessions: 0, libraries: 0 });
  } finally {
    await sql.close();
  }
});
