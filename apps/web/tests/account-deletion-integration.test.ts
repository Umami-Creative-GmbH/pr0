// oxlint-disable unicorn/no-await-expression-member, eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Sequential public HTTP scenarios and bounded recovery polling preserve the external failure order.
import { expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";

import { verifyDeletionReceipt } from "@pr0/api-client/deletions";
import { deletionTrustSchema } from "@pr0/api-contract/deletions";
import { SQL } from "bun";

import { runAcceptance } from "./account-test-server";
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
  const exported = await new Response(backup.stdout).text();
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

test("independent ledger failure leaves pending deletion and recovery finishes without its session", async () => {
  const browser = await freshSocialBrowser();
  const trust = deletionTrustSchema.parse(
    await (
      await fetch(`${origin}/api/v1/account/deletion`, {
        headers: { Cookie: browser.Cookie },
      })
    ).json()
  );
  const storage = new SQL(process.env.PR0_LEDGER_B_URL ?? "");
  try {
    await storage.unsafe(`CREATE FUNCTION fixture_reject_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled ledger failure'; END; $$;
      CREATE TRIGGER fixture_reject_evidence BEFORE INSERT ON deletion_record FOR EACH ROW EXECUTE FUNCTION fixture_reject_evidence();`);
    const response = await post(
      "/api/v1/account/deletion",
      { ...browser.identity, confirmation: "delete-account" },
      { Cookie: browser.Cookie }
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      status: "pending",
      handle: trust.handle,
      retryAfter: 5,
    });
    const library = await fetch(`${origin}/api/v1/library`, {
      headers: { Cookie: browser.Cookie },
    });
    expect(library.ok).toBe(false);
    const lookup = await fetch(
      `${origin}/api/v1/account-deletions/${trust.handle}`
    );
    expect(await lookup.json()).toEqual({ status: "absent" });
  } finally {
    await storage.unsafe(
      "DROP TRIGGER IF EXISTS fixture_reject_evidence ON deletion_record; DROP FUNCTION IF EXISTS fixture_reject_evidence()"
    );
    await storage.close();
  }
  let result;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Observe automatic recovery at the unauthenticated public boundary.
    result = await (
      await fetch(`${origin}/api/v1/account-deletions/${trust.handle}`)
    ).json();
    if (result.status === "deleted") {
      break;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Bounded external recovery polling.
    await Bun.sleep(500);
  }
  expect(result.status).toBe("deleted");
  expect((await verifyDeletionReceipt(result.receipt, trust)).accountId).toBe(
    browser.identity.accountId
  );
});

test("rotated receipts verify from the original pinned anchor and old receipts remain valid", async () => {
  const browser = await freshSocialBrowser();
  const pinned = deletionTrustSchema.parse(
    await (
      await fetch(`${origin}/api/v1/account/deletion`, {
        headers: { Cookie: browser.Cookie },
      })
    ).json()
  );
  await runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/deletions.ts",
    "rotate",
  ]);
  const rotated = deletionTrustSchema.parse(
    await (
      await fetch(`${origin}/api/v1/account/deletion`, {
        headers: { Cookie: browser.Cookie },
      })
    ).json()
  );
  expect(rotated.anchor).toEqual(pinned.anchor);
  expect(rotated.rotations.length).toBe(pinned.rotations.length + 1);
  const result = await (
    await post(
      "/api/v1/account/deletion",
      { ...browser.identity, confirmation: "delete-account" },
      { Cookie: browser.Cookie }
    )
  ).json();
  expect(result.status).toBe("deleted");
  await expect(verifyDeletionReceipt(result.receipt, pinned)).rejects.toThrow();
  expect(
    (
      await verifyDeletionReceipt(result.receipt, {
        ...pinned,
        rotations: rotated.rotations,
      })
    ).accountId
  ).toBe(browser.identity.accountId);
  await expect(
    verifyDeletionReceipt(result.receipt, {
      ...rotated,
      rotations: [...rotated.rotations, ...rotated.rotations],
    })
  ).rejects.toThrow();
});

test("confirmed deletion publishes a minimal Ed25519 receipt after revoking the account", async () => {
  const browser = await freshSocialBrowser();
  const setup = await fetch(`${origin}/api/v1/account/deletion`, {
    headers: { Cookie: browser.Cookie },
  });
  expect(setup.status).toBe(200);
  const trust = await setup.json();
  const response = await post(
    "/api/v1/account/deletion",
    {
      ...browser.identity,
      confirmation: "delete-account",
    },
    { Cookie: browser.Cookie }
  );
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.status).toBe("deleted");
  const [header, body, signature] = result.receipt.split(".");
  const lastRotation = trust.rotations.at(-1);
  const currentKey = lastRotation
    ? JSON.parse(
        Buffer.from(lastRotation.split(".")[1], "base64url").toString()
      ).key
    : trust.anchor;
  expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
    alg: "Ed25519",
    typ: "pr0-account-deletion+jws",
    kid: currentKey.kid,
  });
  expect(
    verify(
      null,
      Buffer.from(`${header}.${body}`),
      createPublicKey({ key: currentKey, format: "jwk" }),
      Buffer.from(signature, "base64url")
    )
  ).toBe(true);
  expect((await verifyDeletionReceipt(result.receipt, trust)).accountId).toBe(
    browser.identity.accountId
  );
  expect(JSON.parse(Buffer.from(body, "base64url").toString())).toEqual({
    version: 1,
    instanceId: trust.instanceId,
    accountId: browser.identity.accountId,
    handle: trust.handle,
    deletionId: expect.any(String),
    deletedAt: expect.any(String),
  });
  const lookup = await fetch(
    `${origin}/api/v1/account-deletions/${trust.handle}`
  );
  expect(await lookup.json()).toEqual(result);
  const library = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: browser.Cookie },
  });
  expect(library.status).toBe(401);
});
