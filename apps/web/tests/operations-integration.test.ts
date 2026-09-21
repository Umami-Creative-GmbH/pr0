// oxlint-disable unicorn/no-await-expression-member -- Keep public HTTP status assertions adjacent to the request being verified.
// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Admission scenarios must send requests in order to establish the exact shared bucket state.
import { expect, test } from "bun:test";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { createChangeClient } from "@pr0/api-client/changes";
import { SQL } from "bun";

import serviceFailures from "../../../packages/api-contract/src/service-failure-fixtures.json";
import { runAcceptance } from "./account-test-server";
import { origin, post, ingressHeaders } from "./http-fixture";
import { promptBrowser, promptOperation } from "./prompt-fixture";

const peerOrigin = process.env.PR0_TEST_PEER_ORIGIN ?? origin;

test("readiness detects lost local search data despite a durable projection checkpoint", async () => {
  const account = await promptBrowser();
  expect((await account.mutate([promptOperation()])).status).toBe(200);
  expect((await account.get("?limit=1")).status).toBe(200);
  expect(await (await fetch(`${origin}/api/v1/ready`)).json()).toMatchObject({
    checks: { search: "ready" },
  });
  const filename = path.resolve(
    "apps/web/.data/search",
    `${account.identity.instanceId}-${account.identity.accountId}.sqlite`
  );
  await rename(filename, `${filename}.held`);
  try {
    expect(await (await fetch(`${origin}/api/v1/ready`)).json()).toMatchObject({
      checks: { search: "search_preparing" },
    });
    const metrics = await fetch(`${origin}/api/v1/operations/metrics`, {
      headers: { Authorization: "Bearer local-operations-metrics-secret" },
    });
    expect((await metrics.json()).alerts).toContain("readiness_unavailable");
  } finally {
    await rename(`${filename}.held`, filename);
  }
  expect(await (await fetch(`${origin}/api/v1/ready`)).json()).toMatchObject({
    checks: { search: "ready" },
  });
});

test("failed login pairs remain limited across processes after the anonymous burst resets", async () => {
  const headers = ingressHeaders();
  const email = `login-abuse-${crypto.randomUUID()}@example.test`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(
      `${attempt % 2 ? peerOrigin : origin}/api/auth/sign-in/email`,
      {
        method: "POST",
        headers: {
          ...headers,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password: "incorrect-but-long-enough" }),
      }
    );
    expect(response.status).toBe(401);
  }
  await Bun.sleep(10_100);
  const denied = await post(
    "/api/auth/sign-in/email",
    { email, password: "incorrect-but-long-enough" },
    headers
  );
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(800);
  const otherIp = await post("/api/auth/sign-in/email", {
    email,
    password: "incorrect-but-long-enough",
  });
  expect(otherIp.status).toBe(401);
  const metrics = await fetch(`${origin}/api/v1/operations/metrics`, {
    headers: { Authorization: "Bearer local-operations-metrics-secret" },
  });
  const payload = await metrics.json();
  expect(payload.errors).toContainEqual({
    boundary: "account",
    code: "invalid_credentials",
    count: 11,
  });
  expect(JSON.stringify(payload)).not.toContain(email);
});

test("authenticated API requests share the account budget across processes", async () => {
  const account = await promptBrowser();
  let response = await account.get("?limit=1");
  for (let attempt = 0; attempt < 120 && response.ok; attempt += 1) {
    response = await fetch(
      `${attempt % 2 ? peerOrigin : origin}/api/v1/library`,
      { headers: { Cookie: account.Cookie } }
    );
  }
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(await response.json()).toMatchObject({ code: "rate_limited" });
});

test("mutation bursts return mixed outcomes and retry only the retained rejection", async () => {
  const account = await promptBrowser();
  for (const size of [100, 99]) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Consume the real per-account burst with committed batches.
    const response = await account.mutate(
      Array.from({ length: size }, () => promptOperation())
    );
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each batch must be acknowledged before sending its successor.
    const body = await response.json();
    expect(
      body.results.every(
        (result: { status: string }) => result.status === "accepted"
      )
    ).toBe(true);
  }
  const operations = [promptOperation(), promptOperation()];
  const response = await fetch(`${peerOrigin}/api/v1/sync/mutations`, {
    method: "POST",
    headers: {
      Cookie: account.Cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...account.identity, operations }),
  });
  const body = await response.json();
  expect(body.results).toMatchObject([
    { status: "accepted" },
    {
      status: "rejected",
      error: {
        code: "rate_limited",
        operationId: operations[1]?.operationId,
        retryable: true,
      },
    },
  ]);
  await Bun.sleep(body.results[1].error.retryAfter * 1000);
  const [, rejected] = operations;
  if (!rejected) {
    throw new Error("Missing retry operation");
  }
  const retried = await account.mutate([rejected]);
  expect(await retried.json()).toMatchObject({
    results: [{ status: "accepted", operationId: rejected.operationId }],
  });
  const detail = await account.get(`/${rejected.promptId}`);
  expect(await detail.json()).toMatchObject({
    content: rejected.desired.content,
  });
});

test("storage alerts start at seventy percent and escalate at eighty including missing observations", async () => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  try {
    await sql`INSERT INTO storage_observation(name,total_bytes,used_bytes,sampled_at) VALUES ('database',1000,700,clock_timestamp()),('ledger-a',1000,800,clock_timestamp())`;
    const response = await fetch(`${origin}/api/v1/operations/metrics`, {
      headers: { Authorization: "Bearer local-operations-metrics-secret" },
    });
    const metrics = await response.json();
    expect(metrics.alerts).toContain("storage_expand:database");
    expect(metrics.alerts).toContain("storage_critical:ledger-a");
    expect(metrics.alerts).toContain("storage_coverage_missing");
  } finally {
    await sql`DELETE FROM storage_observation`;
    await sql.close();
  }
});

test("forwarded header spoofing cannot obtain fresh anonymous admission buckets", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Spoofed peers attempt to reset the same shared bucket.
    await fetch(`${attempt % 2 ? peerOrigin : origin}/api/auth/providers`, {
      headers: {
        "X-Forwarded-For": `192.0.2.${attempt}`,
        "x-pr0-client-ip": `192.0.2.${attempt}`,
        "x-pr0-ingress-secret": "spoofed",
      },
    });
  }
  const denied = await fetch(`${peerOrigin}/api/auth/providers`, {
    headers: { "X-Forwarded-For": "203.0.113.99" },
  });
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);
});

test("IPv6 addresses in the same /64 share admission across processes", async () => {
  const headers = {
    ...ingressHeaders(),
    "x-pr0-client-ip": "2001:db8:6060:abcd::1",
  };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Fill the documented burst through real requests.
    expect(
      (await fetch(`${origin}/api/auth/providers`, { headers })).status
    ).toBe(200);
  }
  const denied = await fetch(`${peerOrigin}/api/auth/providers`, {
    headers: { ...headers, "x-pr0-client-ip": "2001:0db8:6060:abcd:ffff::2" },
  });
  expect(denied.status).toBe(429);
});

test("the external authenticated probe verifies a canary and counts missing monthly samples unavailable", async () => {
  const account = await promptBrowser();
  const canary = promptOperation({
    title: "pr0-availability-canary",
    description: "",
    content: "probe",
  });
  expect((await account.mutate([canary])).status).toBe(200);
  const directory = path.resolve(".scratch", `probe-${crypto.randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const cookieFile = path.join(directory, "cookie");
  const output = path.join(directory, "samples.jsonl");
  await Bun.write(cookieFile, account.Cookie);
  const run = async (args: string[]) => {
    const child = Bun.spawn(
      ["bun", "apps/web/scripts/availability.ts", ...args],
      {
        env: {
          ...process.env,
          PR0_PROBE_ORIGIN: origin,
          PR0_PROBE_COOKIE_FILE: cookieFile,
          PR0_PROBE_PROMPT_ID: canary.promptId,
        },
        stdout: "pipe",
        stderr: "inherit",
      }
    );
    const text = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    return JSON.parse(text);
  };
  try {
    expect(await run(["probe", output])).toMatchObject({ available: true });
    const report = await run([
      "report",
      output,
      new Date().toISOString().slice(0, 7),
    ]);
    expect(report.availableMinutes).toBe(1);
    expect(report.missingMinutes).toBeGreaterThan(0);
    expect(report.targetMet).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("operational metrics are private and report missing backup/storage coverage without sensitive content", async () => {
  const url = `${origin}/api/v1/operations/metrics`;
  expect((await fetch(url)).status).toBe(404);
  const response = await fetch(url, {
    headers: { Authorization: "Bearer local-operations-metrics-secret" },
  });
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toMatchObject({
    backup: { status: "unavailable" },
    ledger: { status: "ready" },
  });
  expect(payload.alerts).toContain("backup_unavailable");
  expect(payload.alerts).toContain("storage_coverage_missing");
  expect(JSON.stringify(payload)).not.toContain("local-social-test");
});

test("readiness distinguishes a running process from usable schema, deletion replay, email and prepared search", async () => {
  const account = await promptBrowser();
  expect((await account.mutate([promptOperation()])).status).toBe(200);
  expect((await fetch(`${origin}/api/v1/health`)).status).toBe(200);
  const response = await fetch(`${origin}/api/v1/ready`);
  expect(await response.json()).toMatchObject({
    checks: {
      schema: "ready",
      deletionReplay: "ready",
      email: "ready",
      search: "search_preparing",
    },
  });
});

test("search waits briefly for busy workers and returns every queued account's results", async () => {
  const accounts: Awaited<ReturnType<typeof promptBrowser>>[] = [];
  for (let index = 0; index < 3; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Create independent public accounts before imposing the external database delay.
    accounts.push(await promptBrowser());
  }
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const holding = sql.begin(async (tx) => {
    for (const account of accounts) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Delay the real database boundary until all HTTP queries are queued.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${account.identity.accountId},56))`;
    }
    locked.resolve();
    await release.promise;
  });
  try {
    await locked.promise;
    const requests = accounts.map((account) => account.get("?query=complete"));
    await Bun.sleep(350);
    release.resolve();
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
  } finally {
    release.resolve();
    await holding;
    await sql.close();
  }
});

test("anonymous auth and device requests share the ten-request burst", async () => {
  const headers = ingressHeaders();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Exercise a single client's request burst in order.
    expect(
      (await fetch(`${origin}/api/auth/providers`, { headers })).status
    ).toBe(200);
  }
  const device = await post("/api/auth/device/token", {}, headers);
  expect(device.status).toBe(429);
  expect(Number(device.headers.get("Retry-After"))).toBeGreaterThan(0);
});

test("registration pause blocks new accounts but permits existing-account recovery", async () => {
  const account = await promptBrowser();
  await runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/accounts.ts",
    "pause-registration",
  ]);
  try {
    const signup = await post("/api/auth/sign-up/email", {
      email: `paused-${crypto.randomUUID()}@example.test`,
      password: "valid-password-for-test",
    });
    expect(signup.status).toBe(403);
    expect(await signup.json()).toMatchObject({ code: "registration_closed" });
    expect(
      (await post("/api/auth/request-password-reset", { email: account.email }))
        .status
    ).toBe(202);
    expect((await account.get("?limit=1")).status).toBe(200);
  } finally {
    await runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/accounts.ts",
      "resume-registration",
    ]);
  }
});

test("operator suspension preserves prompts and recovery, and resuming restores the same library", async () => {
  const account = await promptBrowser();
  const prompt = promptOperation();
  expect((await account.mutate([prompt])).status).toBe(200);
  await runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/accounts.ts",
    "suspend",
    account.identity.accountId,
  ]);
  const denied = await account.get(`/${prompt.promptId}`);
  const suspended = serviceFailures.find(
    (entry) => entry.code === "account_suspended"
  );
  if (!suspended) {
    throw new Error("Missing suspension conformance fixture");
  }
  expect(denied.status).toBe(suspended.status);
  expect(await denied.json()).toMatchObject({
    code: suspended?.code,
    retryable: suspended?.retryable,
  });
  expect(
    (await post("/api/auth/request-password-reset", { email: account.email }))
      .status
  ).toBe(202);
  await runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/accounts.ts",
    "resume",
    account.identity.accountId,
  ]);
  const restored = await account.get(`/${prompt.promptId}`);
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({
    id: prompt.promptId,
    content: prompt.desired.content,
  });
});

test("four waiting polls retain their slots while a fifth receives retry guidance", async () => {
  const account = await promptBrowser();
  const client = createChangeClient(origin, account.identity, (url, init) =>
    fetch(url, { ...init, headers: { Cookie: account.Cookie } })
  );
  const checkpoint = await client.poll({ wait: 0 });
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const waiting = controllers.map(async (controller, index) => {
    try {
      await createChangeClient(
        index % 2 ? peerOrigin : origin,
        account.identity,
        (url, init) =>
          fetch(url, { ...init, headers: { Cookie: account.Cookie } })
      ).poll({ cursor: checkpoint.cursor, wait: 25 }, controller.signal);
    } catch {
      /* Explicit cancellation ends the held poll. */
    }
  });
  try {
    await Bun.sleep(1000);
    const response = await fetch(
      `${origin}/api/v1/sync/changes?cursor=${encodeURIComponent(checkpoint.cursor)}&wait=1`,
      {
        headers: { Cookie: account.Cookie },
      }
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.json()).toMatchObject({
      code: "temporarily_unavailable",
      retryable: true,
    });
    // Waiting polls must leave capacity for ordinary library work.
    expect((await account.get("?limit=1")).status).toBe(200);
  } finally {
    for (const controller of controllers) {
      controller.abort();
    }
    await Promise.all(waiting);
  }
});
