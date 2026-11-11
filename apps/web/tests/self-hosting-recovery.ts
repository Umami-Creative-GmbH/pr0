import assert from "node:assert/strict";
import path from "node:path";

import { accountSettingsSchema } from "@pr0/api-contract/accounts";
import {
  deletionIdentitySchema,
  deletionLookupSchema,
  deletionResultSchema,
} from "@pr0/api-contract/deletions";
import { z } from "zod";

import { selfHostingClient } from "./self-hosting-client";
import { selfHostingPassword } from "./self-hosting-fixture";
import type { SelfHostingInstance } from "./self-hosting-fixture";

export const registerSelfHoster = async (
  instance: SelfHostingInstance,
  email: string
) => {
  const signup = await instance.request("/api/auth/sign-up/email", {
    email,
    password: selfHostingPassword,
  });
  assert.equal(signup.status, 202, await signup.text());
  const link = await instance.verificationLink(email);
  const verified = await fetch(link, { redirect: "manual" });
  assert.equal(
    verified.headers.get("location"),
    `${instance.origin}/?verified=1`
  );
  return instance.login(email);
};

export const verifySelfHostingIsolation = async (
  instance: SelfHostingInstance,
  peer: SelfHostingInstance,
  email: string,
  cookie: string
) => {
  await peer.initialize(email);
  const peerCookie = await registerSelfHoster(peer, email);
  const original = await instance.library(cookie);
  const independent = await peer.library(peerCookie);
  assert.notEqual(independent.instance.id, original.instance.id);
  assert.notEqual(independent.account.id, original.account.id);
  assert.equal(independent.account.email, original.account.email);
  const prompts = await selfHostingClient(peer, peerCookie).getPrompts();
  assert.equal(prompts.prompts.length, 0);
  const wrongInstance = await peer.request(
    "/api/v1/library",
    undefined,
    cookie
  );
  assert.equal(wrongInstance.status, 401);
  return { peerCookie, independent };
};

export const verifySelfHostingRestore = async (
  instance: SelfHostingInstance,
  email: string,
  cookie: string,
  promptId: string
) => {
  const before = await instance.library(cookie);
  await instance.configure({ PR0_REGISTRATION: "allowlist" });
  const deletedEmail = "deleted-self-hoster@example.test";
  await instance.compose("run", "--rm", "accounts", "allow", deletedEmail);
  await instance.compose("up", "-d", "--no-build", "web", "mail");
  await instance.ready();
  const deletedCookie = await registerSelfHoster(instance, deletedEmail);
  const trustResponse = await instance.request(
    "/api/v1/account/deletion",
    undefined,
    deletedCookie
  );
  const trust = deletionIdentitySchema.parse(await trustResponse.json());
  const settingsResponse = await instance.request(
    "/api/v1/account",
    undefined,
    deletedCookie
  );
  const identity = accountSettingsSchema.parse(await settingsResponse.json());
  const backup = z
    .object({ archive: z.string(), checkpoint: z.string() })
    .parse(
      JSON.parse(await instance.compose("run", "--rm", "backup", "create"))
    );
  const fresh = await instance.request(
    "/api/v1/account/reauth/verify",
    {
      accountId: identity.accountId,
      emailVersion: identity.emailVersion,
      password: selfHostingPassword,
    },
    deletedCookie
  );
  assert.equal(fresh.status, 200, await fresh.text());
  const deletion = await instance.request(
    "/api/v1/account/deletion",
    {
      accountId: identity.accountId,
      emailVersion: identity.emailVersion,
      confirmation: "delete-account",
    },
    deletedCookie
  );
  assert.equal(deletion.status, 200);
  const deleted = deletionResultSchema.parse(await deletion.json());
  // The deletion log: the web container's structured stdout lines.
  const deletionLog = await instance.compose("logs", "--no-log-prefix", "web");
  assert.ok(deletionLog.includes(`"accountId":"${trust.accountId}"`));
  assert.ok(
    !deletionLog.includes(deletedEmail),
    "no email in the deletion log"
  );
  const started = Date.now();
  await instance.compose("run", "--rm", "restore", "close");
  const closed = await instance.request("/api/v1/library", undefined, cookie);
  assert.equal(closed.status, 503);
  await instance.compose("stop", "web", "mail");
  // Explicitly replace only this randomly named fixture's application database.
  // The recovery volume and the web container's log survive the ordinary-data loss.
  await instance.compose(
    "exec",
    "-T",
    "database",
    "dropdb",
    "-U",
    "pr0",
    "--force",
    "pr0"
  );
  await instance.compose(
    "exec",
    "-T",
    "database",
    "createdb",
    "-U",
    "pr0",
    "pr0"
  );
  await instance.compose("run", "--rm", "backup", "restore", backup.archive);
  await Bun.write(
    path.join(instance.directory, "BETTER_AUTH_SECRET"),
    `${crypto.randomUUID()}-${crypto.randomUUID()}`
  );
  const restoredOwner = await instance.compose(
    "exec",
    "-T",
    "database",
    "psql",
    "-U",
    "pr0",
    "-d",
    "pr0",
    "-tAc",
    `SELECT count(*) FROM "user" WHERE id='${trust.accountId}'`
  );
  assert.equal(
    restoredOwner.trim(),
    "1",
    "the older archive brings the account back"
  );
  // Runbook step: re-delete every account in the deletion log before reopening.
  const reapplied = await instance.composeInput(
    deletionLog,
    "run",
    "--rm",
    "-T",
    "deletions",
    "reapply"
  );
  assert.match(reapplied, /"read":1,"purged":1/u);
  await instance.compose("run", "--rm", "restore", "prepare");
  await instance.compose(
    "up",
    "-d",
    "--no-build",
    "--force-recreate",
    "web",
    "mail"
  );
  await instance.ready(503);
  const prepared = await instance.request("/api/v1/ready");
  assert.equal(prepared.status, 503);
  await assert.rejects(instance.compose("run", "--rm", "restore", "open"));
  await instance.compose("run", "--rm", "backup", "create");
  await instance.compose("run", "--rm", "restore", "open");
  await instance.ready();
  const obsolete = await instance.request("/api/v1/library", undefined, cookie);
  assert.equal(obsolete.status, 401);
  const deletedSession = await instance.request(
    "/api/v1/library",
    undefined,
    deletedCookie
  );
  assert.equal(deletedSession.status, 401);
  const lookupResponse = await instance.request(
    `/api/v1/account-deletions/${trust.handle}`
  );
  const lookup = deletionLookupSchema.parse(await lookupResponse.json());
  assert.equal(lookup.status, "deleted");
  assert.deepEqual(lookup, deleted);
  const revivedLogin = await instance.request("/api/auth/sign-in/email", {
    email: deletedEmail,
    password: selfHostingPassword,
  });
  assert.equal(revivedLogin.status, 401);
  const recoveredCookie = await instance.login(email);
  const recovered = await instance.library(recoveredCookie);
  assert.equal(recovered.instance.id, before.instance.id);
  assert.equal(recovered.account.id, before.account.id);
  assert.notEqual(recovered.epoch, before.epoch);
  const prompt = await selfHostingClient(instance, recoveredCookie).getPrompt(
    promptId
  );
  assert.ok(prompt.content.includes("{{name}}"));
  const recoverySeconds = (Date.now() - started) / 1000;
  const lossWindowSeconds = (started - Date.parse(backup.checkpoint)) / 1000;
  assert.ok(recoverySeconds < 86_400);
  assert.ok(lossWindowSeconds < 3600);
  return {
    recoverySeconds,
    lossWindowSeconds,
    deletedAccountRevived: false,
    deletionReappliedFromLog: true,
  };
};
