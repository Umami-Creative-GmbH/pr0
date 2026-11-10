// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- The upgrade sequence and its stream copies are strictly ordered.
// Redeploys the hosted stack to one commit with the documented upgrade sequence.
// Run from the pinned checkout, under the maintenance lock shared with the backup timer:
//   flock -w 1800 /run/lock/pr0-maintenance.lock bun infrastructure/hosted/redeploy.ts <commit>
// It stops at the first failed step. After ingress closes, a failure leaves it closed and
// never touches data: no initialization, restore, volume removal or rollback.
// See docs/operations/hosted.md.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  availabilitySampleSchema,
  instanceConfigurationPattern,
  parseLastJsonLine,
} from "@pr0/api-contract/operator-output";
import { z } from "zod";

const checkout = process.cwd();
const environmentFile = path.join(checkout, ".env");
const recordDirectory = path.join(checkout, ".deployments");
const scratchReserveBytes = 16n * 1024n * 1024n;
const checkIntervalMs = 5000;
/**
 * How long the check step waits for the canary and then for readiness while
 * web starts and search prepares. PR0_REDEPLOY_CHECK_SECONDS in .env overrides it.
 */
const checkSeconds = { default: 600, minimum: 60, maximum: 1800 } as const;
const revisionPattern = /^[A-Za-z0-9][\w./-]*$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const imageNamePattern = /^[a-z0-9][a-z0-9._/-]*$/u;
const settingPattern = /^(?<name>[A-Z][A-Z0-9_]*)=(?<value>.*)$/u;
const wholeSecondsPattern = /^\d+$/u;
// The script never runs initialization, admission or recovery commands.
const forbiddenArguments = new Set([
  "restore",
  "initialize",
  "admit-first",
  "down",
  "rm",
]);
const releaseSettings = [
  "PR0_IMAGE",
  "PR0_TOOLS_IMAGE",
  "PR0_INGRESS_IMAGE",
  "PR0_BACKUP_RELEASE",
] as const;
const servingServices = ["ingress", "web", "mail"];
type ReleaseSettings = Record<(typeof releaseSettings)[number], string>;
type JsonValue = z.infer<ReturnType<typeof z.json>>;
type StepDetails = Record<string, JsonValue>;
/** Whether the public route can reach the stack; "unknown" until a stop or check proves it. */
type IngressState = "open" | "closed" | "unknown";

interface StepRecord {
  step: string;
  status: "ok" | "failed";
  startedAt: string;
  durationMs: number;
  details?: StepDetails;
  error?: string;
}
interface RedeployRecord {
  event: "redeploy";
  status: "running" | "complete" | "failed";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  checkout: string;
  previousCommit: string;
  commit: string;
  images: Partial<Record<"app" | "tools" | "ingress", ImageRecord>>;
  steps: StepRecord[];
  commands: string[];
}
interface ImageRecord {
  tag: string;
  id: string;
}
interface Target {
  imageName: string;
  checkTimeoutMs: number;
}
const record: RedeployRecord = {
  event: "redeploy",
  status: "running",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: 0,
  checkout,
  previousCommit: "",
  commit: "",
  images: {},
  steps: [],
  commands: [],
};
let recordFile = "";
let ingress: IngressState = "open";
const failureActions: Record<IngressState, string> = {
  open: "Nothing was changed; ingress is still open.",
  closed:
    "Ingress stays closed and data is intact. Inspect the record, fix forward with a new commit, or roll back only to a binary compatible with the current schema.",
  unknown:
    "Ingress may be serving: run docker compose stop ingress, then check docker compose ps. Data is intact; inspect the record and fix forward with a new commit.",
};

const writeRecord = () => {
  if (!recordFile) {
    return;
  }
  const temporary = `${recordFile}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, recordFile);
};
const emit = (event: Record<string, JsonValue>) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const childEnvironment = (overrides: Record<string, string> = {}) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      // Configuration comes only from the checkout's .env, never from the operator's shell.
      ([name]) => !instanceConfigurationPattern.test(name)
    )
  ),
  ...overrides,
});
const copy = async (
  stream: ReadableStream<Uint8Array>,
  sink: NodeJS.WriteStream
) => {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    sink.write(value);
    text += decoder.decode(value, { stream: true });
  }
};
/** Runs a command, mirrors its output to stderr and returns its stdout. */
const run = async (
  command: string[],
  options: { env?: Record<string, string>; allowFailure?: boolean } = {}
) => {
  record.commands.push(command.join(" "));
  const child = Bun.spawn(command, {
    cwd: checkout,
    env: childEnvironment(options.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    copy(child.stdout, process.stderr),
    copy(child.stderr, process.stderr),
    child.exited,
  ]);
  if (code !== 0 && !options.allowFailure) {
    throw new Error(
      `${command.slice(0, 4).join(" ")} exited ${code}: ${stderr.trim().slice(-1500)}`
    );
  }
  return { stdout, code };
};
const compose = async (
  args: string[],
  options: { env?: Record<string, string>; allowFailure?: boolean } = {}
) => {
  const refused = args.find((arg) => forbiddenArguments.has(arg));
  if (refused) {
    throw new Error(`The redeploy script never runs "${refused}"`);
  }
  return await run(["docker", "compose", ...args], options);
};
const git = async (...args: string[]) => {
  const { stdout } = await run(["git", ...args]);
  return stdout.trim();
};

/**
 * Repeats an attempt every few seconds until it succeeds or the next attempt
 * would start after the deadline.
 */
const retry = async <T>(
  deadline: number,
  attempt: () => Promise<T>,
  succeeded: (result: T) => boolean
) => {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const result = await attempt();
    const ok = succeeded(result);
    if (ok || performance.now() + checkIntervalMs > deadline) {
      return { result, attempts, ok };
    }
    await Bun.sleep(checkIntervalMs);
  }
};

const metricsSchema = z.object({
  backup: z.object({ status: z.string(), checkpoint: z.string().nullable() }),
  storage: z.object({ databaseBytes: z.number().nonnegative() }),
});
const freeBytes = z.string().regex(/^\d+$/u).transform(BigInt);
const spaceSchema = z.object({
  migrationBackups: freeBytes,
  scratch: freeBytes,
});
const readinessSchema = z.object({ status: z.number(), body: z.json() });
const backupSchema = z.object({
  event: z.string(),
  archive: z.string(),
  checkpoint: z.string(),
});

const readSettings = () => {
  const settings = new Map<string, string>();
  for (const line of readFileSync(environmentFile, "utf-8").split(/\r?\n/u)) {
    const { name, value } = settingPattern.exec(line)?.groups ?? {};
    if (name !== undefined && value !== undefined) {
      settings.set(name, value);
    }
  }
  return settings;
};
/** Rewrites only the release lines of .env, keeping every other line and comment. */
const writeReleaseSettings = (release: ReleaseSettings) => {
  const pending = new Map(Object.entries(release));
  const lines = readFileSync(environmentFile, "utf-8")
    .replace(/\r?\n$/u, "")
    .split(/\r?\n/u)
    .map((line) => {
      const name = settingPattern.exec(line)?.groups?.name ?? "";
      const value = pending.get(name);
      if (value === undefined) {
        return line;
      }
      pending.delete(name);
      return `${name}=${value}`;
    });
  for (const [name, value] of pending) {
    lines.push(`${name}=${value}`);
  }
  const temporary = `${environmentFile}.redeploy`;
  writeFileSync(temporary, `${lines.join("\n")}\n`, { mode: 0o600 });
  renameSync(temporary, environmentFile);
};
const checkTimeoutMs = (configured = "") => {
  if (!configured) {
    return checkSeconds.default * 1000;
  }
  const seconds = Number(configured);
  if (
    !wholeSecondsPattern.test(configured) ||
    seconds < checkSeconds.minimum ||
    seconds > checkSeconds.maximum
  ) {
    throw new Error(
      `PR0_REDEPLOY_CHECK_SECONDS must be whole seconds from ${checkSeconds.minimum} to ${checkSeconds.maximum}`
    );
  }
  return seconds * 1000;
};

const step = async (name: string, action: () => Promise<StepDetails>) => {
  const started = performance.now();
  const entry: StepRecord = {
    step: name,
    status: "ok",
    startedAt: new Date().toISOString(),
    durationMs: 0,
  };
  record.steps.push(entry);
  try {
    entry.details = await action();
  } catch (error) {
    entry.status = "failed";
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    entry.durationMs = Math.round(performance.now() - started);
    writeRecord();
    emit({
      event: "redeploy_step",
      step: name,
      status: entry.status,
      durationMs: entry.durationMs,
    });
  }
};

const runningServices = async () => {
  const { stdout } = await compose(["ps", "--status", "running", "--services"]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};
/** Stops services and proves they stopped; only then is ingress known to be closed. */
const stopServing = async (services: string[]) => {
  ingress = "unknown";
  await compose(["stop", ...services]);
  const running = await runningServices();
  const stopped = new Set(services);
  const open = running.filter((name) => stopped.has(name));
  if (open.length) {
    throw new Error(`Still running after stop: ${open.join(", ")}`);
  }
  ingress = "closed";
  return running;
};

/** Resolves the commit, checks the checkout and settings, and opens the record. */
const prepare = async (revision: string): Promise<Target> => {
  if (!revisionPattern.test(revision)) {
    throw new Error("Usage: redeploy.ts <commit>");
  }
  if ((await git("status", "--porcelain")) !== "") {
    throw new Error("The pinned checkout has local changes; refusing");
  }
  record.previousCommit = await git("rev-parse", "HEAD");
  record.commit = await git("rev-parse", "--verify", `${revision}^{commit}`);
  if (!commitPattern.test(record.commit)) {
    throw new Error("Revision did not resolve to a commit");
  }
  const settings = readSettings();
  if (!settings.get("COMPOSE_PROJECT_NAME")) {
    throw new Error("Set the fixed COMPOSE_PROJECT_NAME in .env");
  }
  const imageName = settings.get("PR0_IMAGE_NAME") || "pr0";
  if (!imageNamePattern.test(imageName)) {
    throw new Error("PR0_IMAGE_NAME must be a lowercase image name");
  }
  const target = {
    imageName,
    checkTimeoutMs: checkTimeoutMs(settings.get("PR0_REDEPLOY_CHECK_SECONDS")),
  };
  mkdirSync(recordDirectory, { recursive: true, mode: 0o700 });
  recordFile = path.join(
    recordDirectory,
    `${record.startedAt.replaceAll(":", "")}-${record.commit.slice(0, 12)}.json`
  );
  writeRecord();
  emit({
    event: "redeploy_started",
    commit: record.commit,
    previousCommit: record.previousCommit,
    record: recordFile,
  });
  return target;
};

const preflight = async () => {
  const metrics = await compose(
    ["run", "--rm", "--no-deps", "operations", "metrics"],
    { allowFailure: true }
  );
  const observed = parseLastJsonLine(metricsSchema, metrics.stdout);
  if (observed.backup.status !== "ready") {
    throw new Error(
      "No fresh verified backup (backup.status is not ready); run backup create first"
    );
  }
  const { databaseBytes } = observed.storage;
  const required = BigInt(Math.ceil(databaseBytes)) * 3n + scratchReserveBytes;
  // Measured inside the tools image, where migration backups and backup
  // verification actually write.
  const space = await compose([
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "bun",
    "accounts",
    "--bun",
    "-e",
    'const { statfsSync } = require("node:fs"); const free = (p) => { const s = statfsSync(p, { bigint: true }); return String(s.bavail * s.bsize); }; console.log(JSON.stringify({ migrationBackups: free("/var/lib/pr0-backups"), scratch: free(require("node:os").tmpdir()) }));',
  ]);
  const free = parseLastJsonLine(spaceSchema, space.stdout);
  for (const [location, bytes] of Object.entries(free)) {
    if (bytes < required) {
      throw new Error(
        `Insufficient ${location} space: ${bytes} bytes free, ${required} required`
      );
    }
  }
  return {
    backupCheckpoint: observed.backup.checkpoint,
    databaseBytes,
    requiredScratchBytes: String(required),
    freeBytes: Object.fromEntries(
      Object.entries(free).map(([name, bytes]) => [name, String(bytes)])
    ),
  };
};

const closeIngress = async () => ({
  running: await stopServing(servingServices),
});

const build = async ({ imageName }: Target) => {
  await git("checkout", "--quiet", "--detach", record.commit);
  const version = record.commit.slice(0, 12);
  const release: ReleaseSettings = {
    PR0_IMAGE: `${imageName}:${version}`,
    PR0_TOOLS_IMAGE: `${imageName}-tools:${version}`,
    PR0_INGRESS_IMAGE: `${imageName}-ingress:${version}`,
    PR0_BACKUP_RELEASE: `pr0@${record.commit}`,
  };
  // Tags reach .env only after every image exists, so a failed build never
  // points the backup timer at a missing image.
  await compose(["config", "--quiet"], { env: release });
  await compose(["build", "web", "accounts", "ingress"], { env: release });
  for (const [service, tag] of [
    ["app", release.PR0_IMAGE],
    ["tools", release.PR0_TOOLS_IMAGE],
    ["ingress", release.PR0_INGRESS_IMAGE],
  ] as const) {
    const { stdout } = await run([
      "docker",
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      tag,
    ]);
    record.images[service] = { tag, id: stdout.trim() };
  }
  writeReleaseSettings(release);
  return { release: release.PR0_BACKUP_RELEASE };
};

/** Runs a one-off tools command and keeps the tail of its output. */
const toolsCommand = async (service: string, command: string) => {
  const { stdout } = await compose(["run", "--rm", service, command]);
  return { output: stdout.trim().split("\n").slice(-5) };
};

const recreate = async () => {
  await compose([
    "up",
    "--detach",
    "--no-build",
    "--no-deps",
    "--force-recreate",
    "web",
    "mail",
  ]);
  // Readiness is checked in the next step, after the canary search has
  // prepared its projection, as the documented sequence orders it.
  const running = await runningServices();
  if (!(running.includes("web") && running.includes("mail"))) {
    throw new Error(`web and mail did not start: ${running.join(", ")}`);
  }
  return { running };
};

const check = async (target: Target) => {
  const deadline = performance.now() + target.checkTimeoutMs;
  // A first search after an edit can answer search_preparing; retry until the deadline.
  const canary = await retry(
    deadline,
    async () => {
      const { stdout } = await compose(["run", "--rm", "--no-deps", "canary"], {
        allowFailure: true,
      });
      return parseLastJsonLine(availabilitySampleSchema, stdout);
    },
    (sample) => sample.available
  );
  if (!canary.ok) {
    throw new Error(
      `The canary library/search check failed ${canary.attempts} times`
    );
  }
  const readiness = await retry(
    deadline,
    () =>
      compose(
        [
          "exec",
          "-T",
          "web",
          "bun",
          "--bun",
          "-e",
          "const response = await fetch('http://127.0.0.1:3000/api/v1/ready'); console.log(JSON.stringify({ status: response.status, body: await response.json() })); process.exit(response.ok ? 0 : 1);",
        ],
        { allowFailure: true }
      ),
    ({ code }) => code === 0
  );
  if (!readiness.ok) {
    throw new Error(
      `Readiness stayed unavailable: ${readiness.result.stdout.trim().slice(-500)}`
    );
  }
  return {
    canary: { ...canary.result, attempts: canary.attempts },
    readiness: parseLastJsonLine(readinessSchema, readiness.result.stdout),
    readinessAttempts: readiness.attempts,
  };
};

const backup = async () => {
  const { stdout } = await compose(["run", "--rm", "backup", "create"]);
  const result = parseLastJsonLine(backupSchema, stdout);
  if (result.event !== "backup_verified") {
    throw new Error("Backup did not report a verified archive");
  }
  return { archive: result.archive, checkpoint: result.checkpoint };
};

const reopenIngress = async () => {
  ingress = "unknown";
  try {
    await compose([
      "up",
      "--detach",
      "--no-build",
      "--no-deps",
      "--force-recreate",
      "--wait",
      "--wait-timeout",
      "120",
      "ingress",
    ]);
    // Through the ingress itself: proves the new ingress reaches the new web.
    const { stdout } = await compose([
      "exec",
      "-T",
      "ingress",
      "wget",
      "-q",
      "-O",
      "-",
      "http://127.0.0.1:8080/api/v1/ready",
    ]);
    const readiness = parseLastJsonLine(z.json(), stdout);
    ingress = "open";
    return { readiness };
  } catch (error) {
    // Stop at this failed step with ingress closed again; if even that fails,
    // the state stays unknown and the failure action says so.
    try {
      await stopServing(["ingress"]);
    } catch {
      /* The original failure is reported; the ingress state remains "unknown". */
    }
    throw error;
  }
};

const redeploy = async (revision: string) => {
  const started = performance.now();
  try {
    const target = await prepare(revision);
    await step("preflight", preflight);
    await step("close-ingress", closeIngress);
    await step("build", () => build(target));
    await step("migrate", () => toolsCommand("accounts", "migrate"));
    await step("replay-deletions", () => toolsCommand("deletions", "replay"));
    await step("recreate", recreate);
    await step("check", () => check(target));
    await step("backup", backup);
    await step("reopen-ingress", reopenIngress);

    record.status = "complete";
    emit({
      event: "redeploy_complete",
      commit: record.commit,
      images: Object.fromEntries(
        Object.entries(record.images).map(([name, image]) => [
          name,
          { tag: image.tag, id: image.id },
        ])
      ),
      record: recordFile,
    });
  } catch (error) {
    record.status = "failed";
    const failed = record.steps.at(-1);
    emit({
      event: "redeploy_failed",
      step: failed?.status === "failed" ? failed.step : "setup",
      error: error instanceof Error ? error.message : String(error),
      record: recordFile || null,
      ingress,
      action: failureActions[ingress],
    });
    process.exitCode = 1;
  } finally {
    record.finishedAt = new Date().toISOString();
    record.durationMs = Math.round(performance.now() - started);
    writeRecord();
  }
};

if (import.meta.main) {
  await redeploy(process.argv[2] ?? "");
}
