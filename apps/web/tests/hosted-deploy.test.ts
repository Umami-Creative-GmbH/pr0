// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- A disposable deployment is upgraded and polled sequentially.
// Rehearses the hosted Coolify deployment (compose.coolify.yaml) with plain
// docker compose, the way Coolify runs it: build, then `up -d` with the
// application's variables, for one commit after another in the same project.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { createPromptClient } from "@pr0/api-client/prompts";
import { librarySchema } from "@pr0/api-contract/accounts";
import { instanceConfigurationPattern } from "@pr0/api-contract/operator-output";
import { z } from "zod";

import { availablePort } from "./test-network";

const root = path.resolve(import.meta.dir, "../../..");
const coolifyFile = "compose.coolify.yaml";
const postgres =
  "postgres@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca";
const mailpit =
  "axllent/mailpit@sha256:030f06031ce5c60913ac9363da1ab0d4be6fd2a78147dd0e1ca0fcac665d6b34";
const pinnedBaseImage = /^FROM (?<image>nginx:\S+@sha256:[0-9a-f]{64})$/mu;
// The heartbeat stand-in uses the ingress's own pinned nginx, so there is one pin to update.
const nginx = z
  .string()
  .parse(
    pinnedBaseImage.exec(
      await Bun.file(
        path.join(root, "infrastructure/ingress/Dockerfile")
      ).text()
    )?.groups?.image
  );
const password = "disposable-hosted-deploy-password";
const canaryTitle = "pr0-availability-canary";
/** The upgrade sequence, in the order every deploy must run it. */
const jobs = ["backup-before", "migrate"] as const;
const servingServices = ["web", "mail", "ingress", "backup"] as const;
// Coolify's own keys, which it removes before running the file.
const coolifyKeyLine = /^\s+exclude_from_hc: true\r?\n/gmu;
const variableReference = /\$\{(?<name>[A-Z][A-Z0-9_]*)/gu;
const inventoryRow =
  /^\| `(?<name>[A-Z][A-Z0-9_]*)` \| (?<type>config|secret) \| (?<required>yes|no) \|/gmu;
const argInstruction = /^\s*ARG\s/imu;
const dockerTime = /^(?<seconds>[^.]+?)(?:\.(?<fraction>\d+))?Z$/u;
const linkPattern = /http[^\s]+/u;
/** Variables Coolify itself provides; never in Phase. */
const coolifyProvided = new Set(["SOURCE_COMMIT"]);
const expectedSecrets = new Set([
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "PR0_MAIL_SECRET",
  "PR0_INGRESS_SECRET",
  "PR0_METRICS_SECRET",
  "PR0_GOOGLE_CLIENT_SECRET",
  "PR0_GITHUB_CLIENT_SECRET",
  "SMTP_PASSWORD",
  "PR0_BACKUP_KEY",
  "PR0_BACKUP_HEARTBEAT_URL",
]);
/** Settings that name a file but are not secrets: state and release records. */
const stateFileSettings = new Set([
  "PR0_RECOVERY_STATE_FILE",
  "PR0_BACKUP_RELEASE_FILE",
]);

// Strips the operator's own configuration so only the disposable variables apply.
const cleanEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !(instanceConfigurationPattern.test(name) || coolifyProvided.has(name))
    )
  );
const execute = async (command: string[], cwd: string) => {
  const child = Bun.spawn(command, {
    cwd,
    env: cleanEnvironment(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
};
const must = async (command: string[], cwd: string) => {
  const result = await execute(command, cwd);
  if (result.code !== 0) {
    throw new Error(
      `${command.slice(0, 6).join(" ")} failed (${result.code}): ${result.stderr.slice(-3000)}\n${result.stdout.slice(-2000)}`
    );
  }
  return result.stdout.trim();
};
/** The Compose file as Coolify runs it: without Coolify's own keys. */
const asCoolifyRunsIt = (source: string) => source.replace(coolifyKeyLine, "");
/** Docker's RFC 3339 timestamps with nanoseconds, comparable without rounding. */
const nanoseconds = (time: string) => {
  const { seconds = "", fraction = "" } = dockerTime.exec(time)?.groups ?? {};
  return (
    BigInt(Date.parse(`${seconds}Z`)) * 1_000_000n +
    BigInt(fraction.padEnd(9, "0").slice(0, 9))
  );
};

const exampleVariables = {
  SOURCE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
  PR0_ORIGIN: "https://pr0.example.test",
  PR0_REGISTRATION: "allowlist",
  PR0_IMPRESSUM_URL: "https://example.test/impressum",
  PR0_PRIVACY_URL: "https://example.test/privacy",
  PR0_TERMS_URL: "https://example.test/terms",
  SMTP_HOST: "smtp.example.test",
  SMTP_FROM: "pr0@example.test",
  PR0_INGRESS_TRUSTED_PROXIES: "10.0.1.0/24",
  PR0_BACKUP_MOUNT: "/mnt/pr0-backups",
  PR0_DATABASE_NETWORK: "coolify",
  PR0_DATABASE_VOLUME_NAME: "postgres-data-exampledatabaseuuid",
  DATABASE_URL: "postgres://pr0:example@exampledatabaseuuid:5432/pr0",
  BETTER_AUTH_SECRET: "example-secret-auth",
  PR0_MAIL_SECRET: "example-secret-mail",
  PR0_INGRESS_SECRET: "example-secret-ingress",
  PR0_METRICS_SECRET: "example-secret-metrics",
  PR0_BACKUP_KEY: "example-secret-backup-key",
  PR0_BACKUP_HEARTBEAT_URL: "https://heartbeat.example.test/secret",
};
const dependencySchema = z.record(
  z.string(),
  z.object({ condition: z.string() })
);
const configuredService = z.object({
  environment: z.record(z.string(), z.string().nullable()).default({}),
  secrets: z.array(z.json()).optional(),
  ports: z.array(z.json()).optional(),
  networks: z.record(z.string(), z.json()).default({}),
  depends_on: dependencySchema.default({}),
  build: z
    .object({ args: z.record(z.string(), z.json()).optional() })
    .optional(),
  restart: z.string().optional(),
  profiles: z.array(z.string()).optional(),
  command: z.array(z.string()).nullable().optional(),
});
const externalResource = z.object({
  name: z.string(),
  external: z.boolean().optional(),
});
const configuredProject = z.object({
  services: z.record(z.string(), configuredService),
  secrets: z.json().optional(),
  networks: z.record(z.string(), externalResource).default({}),
  volumes: z.record(z.string(), externalResource).default({}),
});
const writeEnvironment = (file: string, variables: Record<string, string>) =>
  Bun.write(
    file,
    `${Object.entries(variables)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`
  );

type Services = z.infer<typeof configuredProject>["services"];
const requiredReference = /\$\{(?<name>[A-Z][A-Z0-9_]*):\?/gu;

/** Secrets are runtime variables: no Compose secrets, no NAME_FILE, no build args. */
const expectRuntimeSecrets = (services: Services) => {
  for (const [name, service] of Object.entries(services)) {
    expect({ name, secrets: service.secrets }).toEqual({
      name,
      secrets: undefined,
    });
    expect({ name, args: service.build?.args }).toEqual({
      name,
      args: undefined,
    });
    const fileSettings = Object.keys(service.environment).filter((setting) =>
      setting.endsWith("_FILE")
    );
    for (const setting of fileSettings) {
      expect(stateFileSettings).toContain(setting);
    }
    // Only the backup containers carry the backup key.
    if (!["backup", "backup-before"].includes(name)) {
      expect({ name, key: service.environment.PR0_BACKUP_KEY }).toEqual({
        name,
        key: undefined,
      });
    }
  }
};

/** The upgrade sequence, what waits for it, and the only public path. */
const expectUpgradeGate = (services: Services) => {
  const dependsOn = (service: string) =>
    Object.fromEntries(
      Object.entries(services[service]?.depends_on ?? {}).map(
        ([name, { condition }]) => [name, condition]
      )
    );
  // The database is a separate Coolify resource: nothing here waits for it.
  expect(dependsOn("backup-before")).toEqual({});
  expect(dependsOn("migrate")).toEqual({
    "backup-before": "service_completed_successfully",
  });
  for (const service of ["web", "mail"]) {
    expect(dependsOn(service)).toEqual({
      migrate: "service_completed_successfully",
    });
  }
  expect(dependsOn("backup")).toEqual({
    migrate: "service_completed_successfully",
  });
  expect(dependsOn("ingress")).toEqual({ web: "service_started" });
  for (const job of jobs) {
    expect(services[job]?.restart).toBe("no");
  }
  // Manual operator commands are never part of a deploy and default to nothing.
  for (const name of ["accounts", "deletions", "restore"]) {
    expect(services[name]?.profiles).toEqual(["operations"]);
    expect(services[name]?.command ?? null).toBeNull();
  }
  // Coolify's proxy reaches only the ingress; the ingress reaches web by alias.
  expect(services.web?.ports).toBeUndefined();
  expect(services.web?.networks.default).toEqual({ aliases: ["pr0-web"] });
  expect(Object.keys(services.ingress?.networks ?? {})).toEqual(["default"]);
  expect(services.ingress?.environment.PR0_INGRESS_UPSTREAM).toBe(
    "pr0-web:3000"
  );
  expect(services.web?.environment.PR0_REGISTRATION).toBe("allowlist");
  expect(services.backup?.environment.PR0_BACKUP_RELEASE).toBe(
    `pr0@${exampleVariables.SOURCE_COMMIT}`
  );
};

/** The Phase inventory names every variable the file reads, once, with its type. */
const expectInventory = async (source: string) => {
  const referenced = new Set(
    [...source.matchAll(variableReference)]
      .map((match) => match.groups?.name ?? "")
      .filter((name) => !coolifyProvided.has(name))
  );
  const required = new Set(
    [...source.matchAll(requiredReference)].map(
      (match) => match.groups?.name ?? ""
    )
  );
  const inventory = await readFile(
    path.join(root, "docs/operations/hosted-variables.md"),
    "utf-8"
  );
  const rows = [...inventory.matchAll(inventoryRow)].map((match) => ({
    name: match.groups?.name ?? "",
    type: match.groups?.type ?? "",
    required: match.groups?.required ?? "",
  }));
  const names = rows.map((row) => row.name);
  expect(names.length).toBe(new Set(names).size);
  expect(new Set(names)).toEqual(referenced);
  expect(
    new Set(rows.filter((row) => row.type === "secret").map((row) => row.name))
  ).toEqual(expectedSecrets);
  for (const row of rows) {
    expect({ name: row.name, required: row.required }).toEqual({
      name: row.name,
      required: required.has(row.name) ? "yes" : "no",
    });
  }
};

test("the Coolify file takes every secret from runtime variables and gates web and mail on the upgrade jobs", async () => {
  await mkdir(path.join(root, ".scratch"), { recursive: true });
  const directory = await mkdtemp(path.join(root, ".scratch/coolify-config-"));
  try {
    const source = await readFile(path.join(root, coolifyFile), "utf-8");
    // Coolify keeps the exited jobs out of the application's health status.
    for (const job of jobs) {
      expect(source).toMatch(
        new RegExp(
          `\\n  ${job}:\\n(?:    .*\\n)*?    exclude_from_hc: true\\n`,
          "u"
        )
      );
    }
    const file = path.join(directory, "compose.yaml");
    await Bun.write(file, asCoolifyRunsIt(source));
    const variables = path.join(directory, "coolify.env");
    await writeEnvironment(variables, exampleVariables);
    const compose = (...args: string[]) =>
      execute(
        ["docker", "compose", "--project-directory", root, "-f", file, ...args],
        root
      );
    const rendered = await compose(
      "--env-file",
      variables,
      "--profile",
      "operations",
      "config",
      "--format",
      "json"
    );
    expect(rendered.stderr).not.toContain("variable is not set");
    expect(rendered.code).toBe(0);
    const { services, secrets, networks, volumes } = configuredProject.parse(
      JSON.parse(rendered.stdout)
    );
    expect(secrets).toBeUndefined();
    // PostgreSQL is the Coolify database resource, reached over its network.
    // Its data volume belongs to that resource and is never created here.
    expect(services.database).toBeUndefined();
    expect(networks.database).toEqual({ name: "coolify", external: true });
    expect(volumes["database-data"]).toEqual({
      name: exampleVariables.PR0_DATABASE_VOLUME_NAME,
      external: true,
    });
    expectRuntimeSecrets(services);
    expectUpgradeGate(services);

    // A missing required variable blocks the deploy with its own message.
    const { PR0_BACKUP_KEY: _key, ...incomplete } = exampleVariables;
    await writeEnvironment(variables, incomplete);
    const blocked = await compose("--env-file", variables, "config", "--quiet");
    expect(blocked.code).not.toBe(0);
    expect(blocked.stderr).toContain("Set PR0_BACKUP_KEY");

    // No build can take a secret: no Dockerfile declares a build argument.
    for (const dockerfile of [
      "Dockerfile",
      "infrastructure/ingress/Dockerfile",
    ]) {
      const instructions = await readFile(path.join(root, dockerfile), "utf-8");
      expect(instructions).not.toMatch(argInstruction);
    }

    await expectInventory(source);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const containerStateSchema = z.object({
  Status: z.string(),
  ExitCode: z.number(),
  StartedAt: z.string(),
  FinishedAt: z.string(),
});
const psSchema = z.object({
  ID: z.string(),
  Service: z.string(),
  Image: z.string(),
  State: z.string(),
});
const jobResultSchema = z.looseObject({ event: z.string() });
const servingServiceNames = new Set<string>(servingServices);
interface JobRun {
  service: string;
  ran: boolean;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
  /** The job's last JSON result line, if it wrote one. */
  result?: z.infer<typeof jobResultSchema> | null;
  /** The job's last output line. */
  output?: string;
}
interface DeployRecord {
  label: string;
  commit: string;
  upExitCode: number;
  upError: string | null;
  jobs: JobRun[];
  /** Services with a running container after the deploy. */
  running: string[];
  /** Each serving service's container state and the image it was created from. */
  serving: Record<string, string>;
  /** When each serving service's current container was created. */
  created: Record<string, string>;
}
/**
 * A new release's containers replaced the old ones before the upgrade
 * sequence started, so the previous release stopped serving first.
 */
const expectReplacedBeforeJobs = (record: DeployRecord) => {
  const firstJob = record.jobs.find((job) => job.service === jobs[0]);
  expect(firstJob?.ran).toBe(true);
  for (const service of servingServices) {
    expect({
      service,
      replacedFirst:
        nanoseconds(record.created[service] ?? "") <
        nanoseconds(firstJob?.startedAt ?? ""),
    }).toEqual({ service, replacedFirst: true });
  }
};
/** The jobs that ran in this deploy ran in the documented order, one after another. */
const expectJobsInOrder = (
  record: DeployRecord,
  expected: readonly string[]
) => {
  const ran = record.jobs.filter((job) => job.ran);
  expect(ran.map((job) => job.service)).toEqual([...expected]);
  for (let index = 1; index < ran.length; index += 1) {
    const before = ran[index - 1];
    const after = ran[index];
    expect(
      nanoseconds(before?.finishedAt ?? "") <=
        nanoseconds(after?.startedAt ?? "")
    ).toBe(true);
  }
};
const exitCodes = (record: DeployRecord) =>
  Object.fromEntries(
    record.jobs
      .filter((job) => job.ran)
      .map((job) => [job.service, job.exitCode])
  );
const event = (record: DeployRecord, service: string) => {
  const job = record.jobs.find((entry) => entry.service === service);
  return job?.result?.event ?? job?.output;
};

test("Coolify's compose deploys run the upgrade jobs in order, upgrade between commits and stop a failed migration before web and mail", async () => {
  await mkdir(path.join(root, ".scratch"), { recursive: true });
  const directory = await mkdtemp(path.join(root, ".scratch/hosted-"));
  const id = crypto.randomUUID().slice(0, 8);
  const project = `pr0-hosted-${id}`;
  const imageName = `pr0-hosted-${id}`;
  const checkout = path.join(directory, "checkout");
  const port = await availablePort();
  const mailPort = await availablePort();
  const origin = `http://localhost:${port}`;
  const heartbeatPath = `/check-${id}`;
  const evidence: unknown[] = [];
  const commits: string[] = [];
  const local = path.join(directory, "local.json");
  const variablesFile = path.join(directory, "coolify.env");
  let deployed = false;
  let passed = false;
  const git = (...args: string[]) =>
    must(
      [
        "git",
        "-c",
        "user.name=pr0 rehearsal",
        "-c",
        "user.email=rehearsal@example.test",
        ...args,
      ],
      checkout
    );
  const composeArgs = () => [
    "docker",
    "compose",
    "-p",
    project,
    "--project-directory",
    checkout,
    "-f",
    path.join(checkout, "coolify.yaml"),
    "-f",
    local,
    "--env-file",
    variablesFile,
  ];
  const compose = (...args: string[]) =>
    must([...composeArgs(), ...args], checkout);
  const composeResult = (...args: string[]) =>
    execute([...composeArgs(), ...args], checkout);
  // The Coolify database resource: a separate Compose project with its own
  // network and data volume, which the application joins and mounts as
  // external resources.
  const databaseProject = `pr0-hosted-db-${id}`;
  const databaseNetwork = databaseProject;
  const databaseVolume = `${databaseProject}-data`;
  const databaseHost = `coolify-db-${id}`;
  const databaseFile = path.join(directory, "database.json");
  let databaseStarted = false;
  const databaseArgs = () => [
    "docker",
    "compose",
    "-p",
    databaseProject,
    "--project-directory",
    directory,
    "-f",
    databaseFile,
  ];
  const databaseCompose = (...args: string[]) =>
    must([...databaseArgs(), ...args], directory);
  /** psql as the database resource's administrator, as the operator runs it. */
  const adminSql = (database: string, statement: string) =>
    databaseCompose(
      "exec",
      "-T",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database,
      "-tAc",
      statement
    );
  try {
    // The commit under test plus three disposable candidates.
    const initial = await must(
      ["git", "rev-parse", process.env.PR0_HOSTED_FROM ?? "HEAD"],
      root
    );
    await must(
      ["git", "clone", "--quiet", "--no-checkout", root, checkout],
      root
    );
    await git("checkout", "--quiet", "-b", "rehearsal", initial);
    await git("commit", "--quiet", "--allow-empty", "-m", "Candidate B");
    const candidate = await git("rev-parse", "HEAD");
    const migrate = path.join(checkout, "apps/web/scripts/migrate.ts");
    const migrateSource = await readFile(migrate, "utf-8");
    await Bun.write(
      migrate,
      migrateSource.replace(
        '  "021-deletion-tombstone.sql",\n',
        '  "021-deletion-tombstone.sql",\n  "022-rehearsal-failure.sql",\n'
      )
    );
    await Bun.write(
      path.join(checkout, "apps/web/migrations/022-rehearsal-failure.sql"),
      "SELECT 1/0;\n"
    );
    await git("add", "--all");
    await git(
      "commit",
      "--quiet",
      "-m",
      "Candidate C with a failing migration"
    );
    const broken = await git("rev-parse", "HEAD");
    await git("revert", "--no-edit", "HEAD");
    const fixed = await git("rev-parse", "HEAD");
    commits.push(initial, candidate, broken, fixed);

    // The application's variables, as Phase would sync them to Coolify.
    await mkdir(path.join(directory, "backups"));
    const databasePassword = crypto.randomUUID();
    const adminPassword = crypto.randomUUID();

    // The Coolify-managed PostgreSQL 17 resource, created before the first
    // deploy: Coolify's administrator is the superuser `postgres`; pr0 runs as
    // its own non-superuser role and database, set up as hosted.md describes.
    await Bun.write(
      databaseFile,
      JSON.stringify({
        services: {
          postgres: {
            image: postgres,
            environment: { POSTGRES_PASSWORD: adminPassword },
            volumes: ["data:/var/lib/postgresql/data"],
            networks: { database: { aliases: [databaseHost] } },
            healthcheck: {
              test: ["CMD", "pg_isready", "-U", "postgres"],
              interval: "1s",
              timeout: "2s",
              retries: 60,
            },
          },
        },
        networks: { database: { name: databaseNetwork } },
        volumes: { data: { name: databaseVolume } },
      })
    );
    databaseStarted = true;
    await databaseCompose("up", "--detach", "--wait");
    await adminSql(
      "postgres",
      `CREATE ROLE pr0 LOGIN CREATEDB PASSWORD '${databasePassword}'`
    );
    await adminSql(
      "postgres",
      "CREATE DATABASE pr0 OWNER pr0 TEMPLATE template0 ENCODING 'UTF8'"
    );
    await adminSql("pr0", "CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(
      await adminSql(
        "postgres",
        "SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = 'pr0'"
      )
    ).toBe("f|t");

    const variables = {
      PR0_IMAGE_NAME: imageName,
      PR0_ORIGIN: origin,
      PR0_REGISTRATION: "allowlist",
      PR0_IMPRESSUM_URL: "https://example.test/impressum",
      PR0_PRIVACY_URL: "https://example.test/privacy",
      PR0_TERMS_URL: "https://example.test/terms",
      SMTP_HOST: "smtp",
      SMTP_PORT: "1025",
      SMTP_TLS: "plain",
      SMTP_FROM: "pr0@example.test",
      PR0_INGRESS_TRUSTED_PROXIES: "10.255.255.0/24",
      PR0_BACKUP_MOUNT: path.join(directory, "backups").replaceAll("\\", "/"),
      PR0_DATABASE_NETWORK: databaseNetwork,
      PR0_DATABASE_VOLUME_NAME: databaseVolume,
      DATABASE_URL: `postgres://pr0:${databasePassword}@${databaseHost}:5432/pr0`,
      BETTER_AUTH_SECRET: `${crypto.randomUUID()}-${crypto.randomUUID()}`,
      PR0_MAIL_SECRET: `${crypto.randomUUID()}-${crypto.randomUUID()}`,
      PR0_INGRESS_SECRET: crypto.randomUUID().replaceAll("-", "").repeat(2),
      PR0_METRICS_SECRET: crypto.randomUUID().replaceAll("-", "").repeat(2),
      PR0_BACKUP_KEY: new Bun.CryptoHasher("sha256")
        .update(crypto.randomUUID())
        .digest("hex"),
      PR0_BACKUP_HEARTBEAT_URL: `http://heartbeat:8080${heartbeatPath}`,
    };
    // Stand-ins for SMTP, the dead-man's switch and
    // Coolify's proxy (the ingress port, published on loopback).
    await Bun.write(
      local,
      JSON.stringify({
        services: {
          smtp: { image: mailpit, ports: [`127.0.0.1:${mailPort}:8025`] },
          heartbeat: {
            image: nginx,
            configs: [{ source: "heartbeat", target: "/etc/nginx/nginx.conf" }],
          },
          ingress: { ports: [`127.0.0.1:${port}:8080`] },
        },
        configs: {
          heartbeat: {
            content:
              'events {}\nhttp {\n  access_log /dev/stdout;\n  server {\n    listen 8080;\n    location / { return 200 "ok"; }\n  }\n}\n',
          },
        },
      })
    );

    // One deploy as Coolify runs it: the commit's Compose file, SOURCE_COMMIT,
    // build, then `up -d`.
    const previousStarts = new Map<string, string>();
    const jobRun = async (service: string) => {
      const container = await compose("ps", "--all", "--quiet", service);
      if (!container) {
        return { service, ran: false };
      }
      const state = containerStateSchema.parse(
        JSON.parse(
          await must(
            ["docker", "inspect", "--format", "{{json .State}}", container],
            root
          )
        )
      );
      // A container compose recreated but never started reports year 1.
      const started = !state.StartedAt.startsWith("0001-");
      const ran = started && state.StartedAt !== previousStarts.get(service);
      previousStarts.set(service, state.StartedAt);
      if (!ran) {
        return { service, ran: false };
      }
      const logs = await execute(
        ["docker", "logs", "--tail", "3", container],
        root
      );
      const lines = `${logs.stdout}\n${logs.stderr}`
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      // The last JSON result line wins; other lines are progress output.
      let result: JobRun["result"] = null;
      for (const line of lines) {
        try {
          result = jobResultSchema.parse(JSON.parse(line));
        } catch {
          // Not a result line.
        }
      }
      return {
        service,
        ran: true,
        exitCode: state.ExitCode,
        startedAt: state.StartedAt,
        finishedAt: state.FinishedAt,
        result,
        output: lines.at(-1) ?? "",
      };
    };
    const containers = async () => {
      const output = await compose("ps", "--all", "--format", "json");
      return output
        .split("\n")
        .filter(Boolean)
        .map((line) => psSchema.parse(JSON.parse(line)));
    };
    const deploy = async (label: string, commit: string) => {
      await git("checkout", "--quiet", "--detach", commit);
      await Bun.write(
        path.join(checkout, "coolify.yaml"),
        asCoolifyRunsIt(
          await readFile(path.join(checkout, coolifyFile), "utf-8")
        )
      );
      await writeEnvironment(variablesFile, {
        ...variables,
        SOURCE_COMMIT: commit,
      });
      deployed = true;
      await compose("build");
      const up = await composeResult("up", "--detach");
      const runs: JobRun[] = [];
      for (const job of jobs) {
        runs.push(await jobRun(job));
      }
      const listed = await containers();
      // The image reference each container was created from. Identical builds
      // share one image ID across commits, so the ID can't tell releases apart.
      const serving: Record<string, string> = {};
      const created: Record<string, string> = {};
      for (const entry of listed) {
        if (servingServiceNames.has(entry.Service)) {
          const inspected = await must(
            [
              "docker",
              "inspect",
              "--format",
              "{{.Config.Image}} {{.Created}}",
              entry.ID,
            ],
            root
          );
          const [reference = "", createdAt = ""] = inspected.split(" ");
          serving[entry.Service] = `${entry.State} ${reference}`;
          created[entry.Service] = createdAt;
        }
      }
      const record: DeployRecord = {
        label,
        commit,
        upExitCode: up.code,
        upError:
          up.code === 0 ? null : (up.stderr.trim().split("\n").at(-1) ?? ""),
        jobs: runs,
        running: listed
          .filter((entry) => entry.State === "running")
          .map((entry) => entry.Service),
        serving,
        created,
      };
      evidence.push(record);
      return record;
    };
    const imagesOf = (commit: string) => ({
      web: `${imageName}:${commit}`,
      mail: `${imageName}:${commit}`,
      ingress: `${imageName}-ingress:${commit}`,
      backup: `${imageName}-tools:${commit}`,
    });
    const expectServing = (record: DeployRecord, commit: string) => {
      const images = imagesOf(commit);
      for (const service of servingServices) {
        expect({ service, state: record.serving[service] }).toEqual({
          service,
          state: `running ${images[service]}`,
        });
      }
    };
    const releaseRecord = () =>
      compose("exec", "-T", "backup", "cat", "/var/lib/pr0-release/release");
    const migrationVersion = () =>
      adminSql("pr0", "SELECT max(version) FROM migration");
    const databaseRunning = async () => {
      const running = await databaseCompose(
        "ps",
        "--status",
        "running",
        "--services"
      );
      return running.split("\n");
    };

    // First deploy. With an empty database the backup is skipped and the
    // schema migrated. The stack starts, but stays closed (503) until the
    // restore barrier is initialized: no recovery state means no admission.
    const first = await deploy("first deploy (before initialization)", initial);
    expect(first.upExitCode).toBe(0);
    expectJobsInOrder(first, jobs);
    expect(exitCodes(first)).toEqual({ "backup-before": 0, migrate: 0 });
    expect(event(first, "backup-before")).toBe("backup_skipped");
    expect(event(first, "migrate")).toBe("release_recorded");
    expectServing(first, initial);
    let closedStatus = 0;
    for (let attempt = 0; attempt < 120 && closedStatus !== 503; attempt += 1) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Poll until the new web answers through the ingress.
        const response = await fetch(`${origin}/api/v1/capabilities`);
        closedStatus = response.status;
      } catch {
        closedStatus = 0;
      }
      if (closedStatus !== 503) {
        // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Bounded polling interval.
        await Bun.sleep(500);
      }
    }
    expect(closedStatus).toBe(503);

    // The one-time manual initialization, then Coolify's "Redeploy", whose
    // backup-before job now takes the first verified backup.
    const email = "operator@example.test";
    const operation = (...args: string[]) =>
      compose("--profile", "operations", "run", "--rm", ...args);
    await operation("restore", "initialize");
    await operation("accounts", "admit-first", email);
    const initialized = await deploy(
      "first deploy (after initialization)",
      initial
    );
    expect(initialized.upExitCode).toBe(0);
    expectJobsInOrder(initialized, jobs);
    expect(exitCodes(initialized)).toEqual({
      "backup-before": 0,
      migrate: 0,
    });
    expect(event(initialized, "backup-before")).toBe("backup_verified");
    expectServing(initialized, initial);
    expect(await releaseRecord()).toBe(`pr0@${initial}`);
    // The schema belongs to pr0's own role, never to Coolify's superuser.
    expect(
      await adminSql(
        "pr0",
        "SELECT tableowner FROM pg_tables WHERE tablename = 'migration'"
      )
    ).toBe("pr0");

    const request = async (
      pathname: string,
      body?: z.infer<ReturnType<typeof z.json>>,
      cookie = ""
    ) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await fetch(`${origin}${pathname}`, {
            method: body === undefined ? "GET" : "POST",
            headers: {
              Origin: origin,
              "Content-Type": "application/json",
              Cookie: cookie,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: "manual",
          });
        } catch (error) {
          // The ingress starts with web's container and may refuse briefly.
          if (attempt >= 30) {
            throw error;
          }
          await Bun.sleep(1000);
        }
      }
    };
    /** Readiness through the ingress, once web answers at all. */
    const readiness = async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await request("/api/v1/ready");
        if (response.status !== 502) {
          return { status: response.status, body: await response.json() };
        }
        await Bun.sleep(1000);
      }
      throw new Error("The ingress never reached web");
    };
    const signUp = await request("/api/auth/sign-up/email", {
      email,
      password,
    });
    expect(signUp.status).toBe(202);
    const mailbox = async (pathname: string) => {
      const response = await fetch(`http://localhost:${mailPort}${pathname}`);
      return z.json().parse(await response.json());
    };
    let link = "";
    for (let attempt = 0; attempt < 80 && !link; attempt += 1) {
      const { messages } = z
        .object({ messages: z.array(z.object({ ID: z.string() })) })
        .parse(await mailbox("/api/v1/messages"));
      const [message] = messages;
      if (message) {
        const detail = z
          .object({ Text: z.string() })
          .parse(await mailbox(`/api/v1/message/${message.ID}`));
        link = linkPattern.exec(detail.Text)?.[0] ?? "";
      }
      await Bun.sleep(250);
    }
    const verified = await fetch(link, { redirect: "manual" });
    expect(verified.status).toBe(303);
    const signIn = await request("/api/auth/sign-in/email", {
      email,
      password,
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const library = async () => {
      const response = await request("/api/v1/library", undefined, cookie);
      expect(response.status).toBe(200);
      return librarySchema.parse(await response.json());
    };
    const before = await library();
    const promptId = crypto.randomUUID();
    const mutation = await request(
      "/api/v1/sync/mutations",
      {
        protocolVersion: 1,
        instanceId: before.instance.id,
        accountId: before.account.id,
        epoch: before.epoch,
        installationId: crypto.randomUUID(),
        operations: [
          {
            operationId: crypto.randomUUID(),
            promptId,
            kind: "prompt.create",
            baseRevision: "0",
            dependsOn: [],
            desired: { title: canaryTitle, description: "", content: "probe" },
          },
        ],
      },
      cookie
    );
    expect(mutation.status).toBe(200);
    const prompts = createPromptClient(origin, (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          Cookie: cookie,
        },
      })
    );
    /**
     * The probe's canary check: library and search find the canary prompt.
     * The first search after an edit prepares the projection, which readiness
     * waits for, so it is retried.
     */
    const canarySearch = async () => {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        try {
          const results = await prompts.getPrompts({
            query: canaryTitle,
            limit: 1,
          });
          if (results.prompts[0]?.id === promptId) {
            return true;
          }
        } catch {
          // search_preparing or web still starting
        }
        await Bun.sleep(5000);
      }
      return false;
    };
    const expectIntact = async () => {
      expect(await canarySearch()).toBe(true);
      const after = await library();
      expect(after.account.id).toBe(before.account.id);
      expect(after.instance.id).toBe(before.instance.id);
      const prompt = await request(
        `/api/v1/library/prompts/${promptId}`,
        undefined,
        cookie
      );
      expect(prompt.status).toBe(200);
      const { content } = z
        .object({ content: z.string() })
        .parse(await prompt.json());
      expect(content).toBe("probe");
      const ready = await readiness();
      expect(ready.status).toBe(200);
      return ready.body;
    };
    await expectIntact();

    // The scheduled backup task, as Coolify runs it in the backup container:
    // success and failure each reach the dead-man's switch with the real code.
    const scheduled = await composeResult(
      "exec",
      "-T",
      "backup",
      "sh",
      "/app/hosted/scheduled-backup.sh"
    );
    expect(scheduled.code).toBe(0);
    const failedScheduled = await composeResult(
      "exec",
      "-T",
      "-e",
      "PR0_BACKUP_DIRECTORY=/nonexistent",
      "backup",
      "sh",
      "/app/hosted/scheduled-backup.sh"
    );
    expect(failedScheduled.code).toBe(1);
    const heartbeatLog = await compose("logs", "--no-log-prefix", "heartbeat");
    const pings = heartbeatLog
      .split("\n")
      .filter((line) => line.includes(`POST ${heartbeatPath}/`))
      .map((line) => line.match(/POST \S+\/(?<code>\d+) /u)?.groups?.code);
    expect(pings).toEqual(["0", "1"]);
    evidence.push({
      label: "scheduled backup task",
      runs: [
        { exitCode: scheduled.code, heartbeat: pings[0] },
        { exitCode: failedScheduled.code, heartbeat: pings[1] },
      ],
    });

    // An upgrade between two commits: the jobs run in order on the new
    // release, then web, mail, ingress and backup run its images.
    const upgrade = await deploy("upgrade", candidate);
    expect(upgrade.upExitCode).toBe(0);
    expectJobsInOrder(upgrade, jobs);
    expectReplacedBeforeJobs(upgrade);
    expect(exitCodes(upgrade)).toEqual({
      "backup-before": 0,
      migrate: 0,
    });
    expectServing(upgrade, candidate);
    expect(await releaseRecord()).toBe(`pr0@${candidate}`);
    // The backup taken before the upgrade names the release that wrote its data.
    const beforeUpgrade = upgrade.jobs.find(
      (job) => job.service === "backup-before"
    )?.result;
    const { archive } = z
      .object({ event: z.literal("backup_verified"), archive: z.string() })
      .parse(beforeUpgrade);
    const label = await compose(
      "exec",
      "-T",
      "backup",
      "sh",
      "-c",
      `bun --bun apps/web/.operations/backup.js configuration ${archive} /tmp/label.json >/dev/null && bun -e 'const { release } = await Bun.file("/tmp/label.json").json(); console.log(release)'; code=$?; rm -f /tmp/label.json; exit $code`
    );
    expect(label).toBe(`pr0@${initial}`);
    Object.assign(upgrade, { backupBeforeRelease: label });
    Object.assign(upgrade, { readiness: await expectIntact() });

    // A failing migration. Compose replaced the old web, mail, ingress and
    // backup containers before the jobs ran; the sequence stops at migrate,
    // so the new ones are created but never start. The service is closed,
    // the database runs, and the schema and release record are unchanged.
    const failure = await deploy("failing migration", broken);
    expect(failure.upExitCode).not.toBe(0);
    expectJobsInOrder(failure, ["backup-before", "migrate"]);
    expectReplacedBeforeJobs(failure);
    expect(exitCodes(failure)).toEqual({ "backup-before": 0, migrate: 1 });
    const brokenImages = imagesOf(broken);
    for (const service of servingServices) {
      expect({ service, state: failure.serving[service] }).toEqual({
        service,
        state: `created ${brokenImages[service]}`,
      });
    }
    expect(await databaseRunning()).toContain("postgres");
    expect(await migrationVersion()).toBe("20");
    let reachable = true;
    try {
      await fetch(`${origin}/api/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      reachable = false;
    }
    expect(reachable).toBe(false);
    Object.assign(failure, { reachable });
    // The backup container is stopped too, so the release record is read
    // from its volume by a one-off container.
    expect(
      await compose(
        "run",
        "--rm",
        "--no-deps",
        "--entrypoint",
        "cat",
        "backup",
        "/var/lib/pr0-release/release"
      )
    ).toBe(`pr0@${candidate}`);

    // Fixing forward with a new commit completes the schema and serves the
    // fixed release with the library intact.
    const recovery = await deploy("fix forward", fixed);
    expect(recovery.upExitCode).toBe(0);
    expectJobsInOrder(recovery, jobs);
    expectReplacedBeforeJobs(recovery);
    expect(exitCodes(recovery)).toEqual({
      "backup-before": 0,
      migrate: 0,
    });
    expectServing(recovery, fixed);
    expect(await migrationVersion()).toBe("20");
    expect(await releaseRecord()).toBe(`pr0@${fixed}`);
    Object.assign(recovery, { readiness: await expectIntact() });
    passed = true;
  } finally {
    if (process.env.PR0_HOSTED_EVIDENCE) {
      await Bun.write(
        process.env.PR0_HOSTED_EVIDENCE,
        `${JSON.stringify(
          {
            recordedAt: new Date().toISOString(),
            composeFile: coolifyFile,
            database: {
              resource:
                "separate PostgreSQL 17 Compose project (stand-in for the Coolify database)",
              image: postgres,
              role: "pr0 (LOGIN CREATEDB, not superuser)",
              joinedBy:
                "external network database, external volume database-data",
            },
            commits: {
              initial: commits[0],
              candidate: commits[1],
              brokenMigration: commits[2],
              fixForward: commits[3],
            },
            passed,
            deploys: evidence,
          },
          null,
          2
        )}\n`
      );
    }
    try {
      if (deployed && !passed) {
        const logs = await composeResult("logs", "--no-color", "--tail", "40");
        process.stderr.write(logs.stdout);
      }
      if (deployed) {
        // Only this run's randomly named project, its volumes and image tags.
        await composeResult(
          "--profile",
          "operations",
          "down",
          "--volumes",
          "--remove-orphans"
        );
      }
      const tags = commits.flatMap((commit) => [
        `${imageName}:${commit}`,
        `${imageName}-tools:${commit}`,
        `${imageName}-ingress:${commit}`,
      ]);
      if (tags.length) {
        await execute(["docker", "image", "rm", ...tags], root);
      }
      if (databaseStarted) {
        // After the application released its network and volume.
        await execute([...databaseArgs(), "down", "--volumes"], directory);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 3_600_000);
