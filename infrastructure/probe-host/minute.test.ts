import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "minute.ts");
const metricsSecret = "test-metrics-secret-value";
const ntfyToken = "test-ntfy-token-value";

let metricsAlerts: string[] = [];
let ntfyStatus = 200;
const ntfy: {
  title: string | null;
  priority: string | null;
  auth: string | null;
  body: string;
}[] = [];
const heartbeats: string[] = [];
const mails: string[] = [];

const metricsPayload = () => ({
  sampledAt: new Date().toISOString(),
  readiness: {
    status: "ready",
    checks: {
      schema: "ready",
      email: "ready",
      search: "ready",
    },
  },
  requests: { active: 0, queued: 0, oldestSeconds: 0 },
  search: {
    active: 0,
    queued: 0,
    oldestSeconds: 0,
    laggingLibraries: 0,
    revisionLag: 0,
  },
  waitingPolls: 0,
  email: { pending: 0, failed: 0, oldestSeconds: 0 },
  storage: {
    databaseBytes: 1,
    logicalTextBytes: 1,
    historyBytes: 1,
    walBytes: null,
    volumes: [],
  },
  backup: { status: "unavailable", checkpoint: null, retentionOk: false },
  errors: [],
  alerts: metricsAlerts,
});

/** The hosted service: only the private metrics route answers; the canary probe is unavailable. */
const origin = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (
      url.pathname === "/api/v1/operations/metrics" &&
      request.headers.get("authorization") === `Bearer ${metricsSecret}`
    ) {
      return Response.json(metricsPayload());
    }
    return new Response(null, { status: 503 });
  },
});

/** ntfy topic and the dead-man's switch. */
const alerts = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/ping/")) {
      heartbeats.push(url.pathname.slice("/ping/".length));
      return new Response("OK");
    }
    if (ntfyStatus !== 200) {
      return new Response(null, { status: ntfyStatus });
    }
    ntfy.push({
      title: request.headers.get("title"),
      priority: request.headers.get("priority"),
      auth: request.headers.get("authorization"),
      body: await request.text(),
    });
    return Response.json({ id: crypto.randomUUID() });
  },
});

/** A minimal SMTP receiver that accepts every message. */
const smtp = Bun.listen<{ buffer: string; data: boolean }>({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) {
      socket.data = { buffer: "", data: false };
      socket.write("220 localhost ESMTP\r\n");
    },
    data(socket, chunk) {
      socket.data.buffer += chunk.toString();
      let index = socket.data.buffer.indexOf("\r\n");
      while (index !== -1) {
        const line = socket.data.buffer.slice(0, index);
        socket.data.buffer = socket.data.buffer.slice(index + 2);
        if (socket.data.data) {
          if (line === ".") {
            socket.data.data = false;
            socket.write("250 queued\r\n");
          } else {
            mails.push(line);
          }
        } else if (/^(?:EHLO|HELO)/iu.test(line)) {
          socket.write("250-localhost\r\n250 OK\r\n");
        } else if (/^DATA/iu.test(line)) {
          socket.data.data = true;
          socket.write("354 go ahead\r\n");
        } else if (/^QUIT/iu.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
        index = socket.data.buffer.indexOf("\r\n");
      }
    },
  },
});

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pr0-probe-host-"));
});

afterEach(() => {
  metricsAlerts = [];
  ntfyStatus = 200;
  ntfy.length = 0;
  heartbeats.length = 0;
  mails.length = 0;
});

afterAll(async () => {
  origin.stop(true);
  alerts.stop(true);
  smtp.stop(true);
  await rm(directory, { recursive: true, force: true });
});

const environment = async (name: string) => {
  const base = path.join(directory, name);
  const secrets = {
    PR0_PROBE_METRICS_SECRET_FILE: metricsSecret,
    PR0_ALERT_NTFY_URL_FILE: `http://127.0.0.1:${alerts.port}/pr0-topic`,
    PR0_ALERT_NTFY_TOKEN_FILE: ntfyToken,
    PR0_ALERT_SMTP_URL_FILE: `smtp://127.0.0.1:${smtp.port}`,
    PR0_ALERT_HEARTBEAT_URL_FILE: `http://127.0.0.1:${alerts.port}/ping/`,
  };
  const credential = (key: string) => path.join(base, "credentials", key);
  const files = {
    PR0_PROBE_METRICS_SECRET_FILE: credential("PR0_PROBE_METRICS_SECRET_FILE"),
    PR0_ALERT_NTFY_URL_FILE: credential("PR0_ALERT_NTFY_URL_FILE"),
    PR0_ALERT_NTFY_TOKEN_FILE: credential("PR0_ALERT_NTFY_TOKEN_FILE"),
    PR0_ALERT_SMTP_URL_FILE: credential("PR0_ALERT_SMTP_URL_FILE"),
    PR0_ALERT_HEARTBEAT_URL_FILE: credential("PR0_ALERT_HEARTBEAT_URL_FILE"),
  };
  await Promise.all(
    Object.entries(secrets).map(([key, value]) =>
      Bun.write(credential(key), `${value}\n`)
    )
  );
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    PR0_PROBE_ORIGIN: origin.url.origin,
    PR0_PROBE_PROMPT_ID: crypto.randomUUID(),
    PR0_PROBE_COOKIE_FILE: path.join(base, "credentials", "missing-cookie"),
    PR0_PROBE_EVIDENCE_DIRECTORY: path.join(base, "evidence"),
    PR0_PROBE_STATE_FILE: path.join(base, "state.json"),
    PR0_ALERT_EMAIL_FROM: "probe@example.test",
    PR0_ALERT_EMAIL_TO: "operator@example.test",
    ...files,
  };
};

const minute = async (env: Record<string, string>) => {
  const child = Bun.spawn([process.execPath, script], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr, summary: JSON.parse(stdout) };
};

test("a metrics alert is pushed and mailed once, failed samples are kept and the heartbeat reports success", async () => {
  const env = await environment("metrics-alert");
  metricsAlerts = ["backup_unavailable"];
  const first = await minute(env);
  expect(first.exitCode).toBe(0);
  expect(first.summary).toMatchObject({
    available: false,
    metrics: "ok",
    metricsAlerts: 1,
    delivered: 2,
    undelivered: 0,
  });
  expect(ntfy).toEqual([
    {
      title: "pr0 metrics alert",
      priority: "urgent",
      auth: `Bearer ${ntfyToken}`,
      body: "New: backup_unavailable. Active: backup_unavailable.",
    },
  ]);
  expect(mails).toContain("Subject: pr0 metrics alert");
  expect(mails).toContain("To: operator@example.test");
  expect(heartbeats).toEqual(["0"]);

  const second = await minute(env);
  expect(second.exitCode).toBe(0);
  expect(ntfy).toHaveLength(1);
  expect(heartbeats).toEqual(["0", "0"]);

  const names = await readdir(env.PR0_PROBE_EVIDENCE_DIRECTORY);
  const evidence = names.filter((name) => name.endsWith(".jsonl"));
  expect(evidence).toEqual([`${new Date().toISOString().slice(0, 7)}.jsonl`]);
  const text = await Bun.file(
    path.join(env.PR0_PROBE_EVIDENCE_DIRECTORY, evidence[0] ?? "")
  ).text();
  const samples = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(samples).toHaveLength(2);
  expect(samples.every((sample) => sample.available === false)).toBe(true);

  for (const output of [first, second]) {
    expect(`${output.stdout}${output.stderr}`).not.toContain(metricsSecret);
    expect(`${output.stdout}${output.stderr}`).not.toContain(ntfyToken);
  }
});

test("an undelivered channel is retried next minute without repeating delivered channels and fails the heartbeat meanwhile", async () => {
  const env = await environment("retry");
  metricsAlerts = ["storage_critical:backup"];
  ntfyStatus = 500;
  const failed = await minute(env);
  expect(failed.exitCode).toBe(1);
  expect(failed.summary).toMatchObject({ delivered: 1, undelivered: 1 });
  expect(heartbeats).toEqual(["1"]);
  expect(mails.filter((line) => line.startsWith("Subject:"))).toHaveLength(1);

  ntfyStatus = 200;
  const retried = await minute(env);
  expect(retried.exitCode).toBe(0);
  expect(ntfy.map((message) => message.title)).toEqual(["pr0 metrics alert"]);
  expect(mails.filter((line) => line.startsWith("Subject:"))).toHaveLength(1);
  expect(heartbeats).toEqual(["1", "0"]);
});

test("an unreachable metrics route is reported without alerting before three minutes", async () => {
  const env = await environment("unreachable");
  await Bun.write(env.PR0_PROBE_METRICS_SECRET_FILE, "wrong-secret\n");
  const result = await minute(env);
  expect(result.exitCode).toBe(0);
  expect(result.summary).toMatchObject({
    metrics: "unreachable",
    metricsAlerts: null,
  });
  expect(ntfy).toEqual([]);
  expect(heartbeats).toEqual(["0"]);
});

test("a missing protected file stops the run before any heartbeat", async () => {
  const env = await environment("misconfigured");
  const child = Bun.spawn([process.execPath, script], {
    env: { ...env, PR0_ALERT_SMTP_URL_FILE: path.join(directory, "absent") },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).not.toBe(0);
  expect(heartbeats).toEqual([]);
});
