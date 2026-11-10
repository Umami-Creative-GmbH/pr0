// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- A disposable deployment is upgraded and polled sequentially.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { librarySchema } from "@pr0/api-contract/accounts";
import { z } from "zod";

import { inheritedConfiguration } from "../../../infrastructure/hosted/redeploy";
import { availablePort, randomOctet } from "./test-network";

const root = path.resolve(import.meta.dir, "../../..");
const postgres =
  "postgres@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca";
const mailpit =
  "axllent/mailpit@sha256:030f06031ce5c60913ac9363da1ab0d4be6fd2a78147dd0e1ca0fcac665d6b34";
const password = "disposable-hosted-redeploy-password";
const canaryTitle = "pr0-availability-canary";
const steps = [
  "preflight",
  "close-ingress",
  "build",
  "migrate",
  "replay-deletions",
  "recreate",
  "check",
  "backup",
  "reopen-ingress",
];
// Strips the operator's own configuration so only the disposable checkout's .env applies.
const cleanEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !inheritedConfiguration.test(name)
    )
  );
const slash = (value: string) => value.replaceAll("\\", "/");
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
      `${command.slice(0, 4).join(" ")} failed (${result.code}): ${result.stderr}\n${result.stdout}`
    );
  }
  return result.stdout.trim();
};
/** Runbook step 7: the canary check passes once its first search has prepared. */
const canaryPasses = async (checkout: string) => {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const sample = await execute(
      ["docker", "compose", "run", "--rm", "canary"],
      checkout
    );
    if (sample.stdout.includes('"available":true')) {
      return true;
    }
    await Bun.sleep(5000);
  }
  return false;
};
type RequestBody = z.infer<ReturnType<typeof z.json>>;
const eventSchema = z.looseObject({ event: z.string() });
const recordSchema = z.object({
  status: z.enum(["complete", "failed"]),
  previousCommit: z.string(),
  commit: z.string(),
  durationMs: z.number(),
  images: z.record(z.string(), z.object({ tag: z.string(), id: z.string() })),
  steps: z.array(
    z.object({
      step: z.string(),
      status: z.enum(["ok", "failed"]),
      durationMs: z.number(),
    })
  ),
  commands: z.array(z.string()),
});
const hostedSecrets = [
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "PR0_MAIL_SECRET",
  "PR0_LEDGER_A_URL",
  "PR0_LEDGER_B_URL",
  "SMTP_PASSWORD",
  "PR0_INGRESS_SECRET",
  "PR0_METRICS_SECRET",
  "PR0_GOOGLE_CLIENT_SECRET",
  "PR0_GITHUB_CLIENT_SECRET",
  "PR0_CANARY_COOKIE",
];
// Secret-bearing setting names that must never carry a value in the example.
const secretSettingPattern =
  /(?:SECRET|PASSWORD|COOKIE|TOKEN|DATABASE_URL|LEDGER_[AB]_URL|HEARTBEAT_URL)$/u;
const configuredService = z.object({
  environment: z.record(z.string(), z.string()),
  secrets: z.array(z.object({ source: z.string() })).default([]),
  ports: z.array(z.object({})).optional(),
  networks: z.record(z.string(), z.json()).default({}),
  labels: z.record(z.string(), z.string()).default({}),
  network_mode: z.string().optional(),
});
const applicationServices = [
  "web",
  "mail",
  "accounts",
  "deletions",
  "restore",
  "backup",
  "operations",
] as const;
const configuredProject = z.object({
  services: z.object({
    web: configuredService,
    mail: configuredService,
    accounts: configuredService,
    deletions: configuredService,
    restore: configuredService,
    backup: configuredService,
    operations: configuredService,
    database: configuredService,
    ingress: configuredService,
    canary: configuredService,
  }),
  networks: z.object({ proxy: z.object({ name: z.string() }) }),
  secrets: z.record(z.string(), z.object({ file: z.string() })),
});
const applicationSecrets = hostedSecrets.filter(
  (name) => !["POSTGRES_PASSWORD", "PR0_CANARY_COOKIE"].includes(name)
);
/** Each application service mounts every application secret and reads it through NAME_FILE. */
const expectFileSecrets = (service: z.infer<typeof configuredService>) => {
  expect(new Set(service.secrets.map((secret) => secret.source))).toEqual(
    new Set(applicationSecrets)
  );
  for (const secret of applicationSecrets) {
    expect(service.environment[`${secret}_FILE`]).toBe(
      `/run/secrets/${secret}`
    );
  }
};

test("the hosted overlay and example name every secret as a file and route the origin root through the ingress", async () => {
  const example = await readFile(
    path.join(root, "infrastructure/hosted/hosted.env.example"),
    "utf-8"
  );
  for (const line of example.split("\n")) {
    const [name = "", value = ""] = line.split("=", 2);
    if (secretSettingPattern.test(name)) {
      expect({ name, value }).toEqual({ name, value: "" });
    }
  }
  const configuration = configuredProject.parse(
    JSON.parse(
      await must(
        [
          "docker",
          "compose",
          "--env-file",
          "infrastructure/hosted/hosted.env.example",
          "-f",
          "compose.yaml",
          "-f",
          "compose.hosted.yaml",
          "--profile",
          "operations",
          "config",
          "--format",
          "json",
        ],
        root
      )
    )
  );
  expect(new Set(Object.keys(configuration.secrets))).toEqual(
    new Set(hostedSecrets)
  );
  for (const [name, secret] of Object.entries(configuration.secrets)) {
    expect(secret.file).toBe(`/etc/pr0/secrets/${name}`);
  }
  const { services } = configuration;
  for (const name of applicationServices) {
    expectFileSecrets(services[name]);
  }
  expect(services.database.environment.POSTGRES_PASSWORD_FILE).toBe(
    "/run/secrets/POSTGRES_PASSWORD"
  );
  const { web, backup } = services;
  expect(web.environment.PR0_REGISTRATION).toBe("allowlist");
  expect(web.environment.PR0_ORIGIN).toBe("https://pr0.umami-creative.app");
  for (const legalLink of [
    "PR0_IMPRESSUM_URL",
    "PR0_PRIVACY_URL",
    "PR0_TERMS_URL",
  ]) {
    expect(web.environment[legalLink]).toStartWith("REPLACE_WITH_");
  }
  expect(web.ports).toBeUndefined();
  expect(backup.environment.PR0_BACKUP_RELEASE).toStartWith("pr0@");
  expect(new Set(Object.keys(services.ingress.networks))).toEqual(
    new Set(["default", "proxy"])
  );
  expect(configuration.networks.proxy.name).toBe("coolify");
  expect(services.ingress.labels).toMatchObject({
    "traefik.enable": "true",
    "traefik.http.routers.pr0-https.rule": "Host(`pr0.umami-creative.app`)",
    "traefik.http.routers.pr0-https.priority": "1",
    "traefik.http.services.pr0-ingress.loadbalancer.server.port": "8080",
  });
  expect(services.canary.network_mode).toBe("service:web");
});
test("the operator script upgrades a disposable hosted deployment between commits and stops closed on failure", async () => {
  await mkdir(path.join(root, ".scratch"), { recursive: true });
  const directory = await mkdtemp(path.join(root, ".scratch/hosted-"));
  const id = crypto.randomUUID().slice(0, 8);
  const project = `pr0-hosted-${id}`;
  const imageName = `pr0-hosted-${id}`;
  const network = `pr0-hosted-${id}-proxy`;
  const subnet = `10.${randomOctet()}.${randomOctet()}.0/24`;
  const checkout = path.join(directory, "checkout");
  const secrets = path.join(directory, "secrets");
  const port = await availablePort();
  const mailPort = await availablePort();
  const origin = `http://localhost:${port}`;
  const evidence: unknown[] = [];
  const compose = (...args: string[]) =>
    must(["docker", "compose", ...args], checkout);
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
  // The same tags redeploy.ts derives from PR0_IMAGE_NAME and the commit.
  const release = (commit: string) => ({
    PR0_IMAGE: `${imageName}:${commit.slice(0, 12)}`,
    PR0_TOOLS_IMAGE: `${imageName}-tools:${commit.slice(0, 12)}`,
    PR0_INGRESS_IMAGE: `${imageName}-ingress:${commit.slice(0, 12)}`,
    PR0_BACKUP_RELEASE: `pr0@${commit}`,
  });
  const commits: string[] = [];
  let deployed = false;
  let networkCreated = false;
  let passed = false;
  try {
    // A pinned checkout of the commit under test plus three disposable candidates.
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
    const source = await readFile(migrate, "utf-8");
    await Bun.write(
      migrate,
      source.replace(
        '  "020-compatible-upgrades.sql",\n',
        '  "020-compatible-upgrades.sql",\n  "021-rehearsal-failure.sql",\n'
      )
    );
    await Bun.write(
      path.join(checkout, "apps/web/migrations/021-rehearsal-failure.sql"),
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
    await git("checkout", "--quiet", "--detach", initial);
    commits.push(initial, candidate, broken, fixed);
    await must(
      ["bun", "install", "--frozen-lockfile", "--filter", "@pr0/hosted"],
      checkout
    );

    await mkdir(secrets);
    await mkdir(path.join(directory, "backups"));
    const databasePassword = crypto.randomUUID();
    const canaryPromptId = crypto.randomUUID();
    const secretValues = {
      POSTGRES_PASSWORD: databasePassword,
      DATABASE_URL: `postgres://pr0:${databasePassword}@database:5432/pr0`,
      BETTER_AUTH_SECRET: `${crypto.randomUUID()}-${crypto.randomUUID()}`,
      PR0_MAIL_SECRET: `${crypto.randomUUID()}-${crypto.randomUUID()}`,
      PR0_LEDGER_A_URL: `postgres://pr0:${databasePassword}@ledger-a:5432/ledger`,
      PR0_LEDGER_B_URL: `postgres://pr0:${databasePassword}@ledger-b:5432/ledger`,
      SMTP_PASSWORD: "unused",
      PR0_INGRESS_SECRET: crypto.randomUUID().replaceAll("-", "").repeat(2),
      PR0_METRICS_SECRET: crypto.randomUUID().replaceAll("-", "").repeat(2),
      PR0_GOOGLE_CLIENT_SECRET: "unused",
      PR0_GITHUB_CLIENT_SECRET: "unused",
      PR0_CANARY_COOKIE: "pending",
    };
    for (const [name, value] of Object.entries(secretValues)) {
      await Bun.write(path.join(secrets, name), value);
    }
    const backupKey = path.join(directory, "backup-key");
    await Bun.write(
      backupKey,
      new Bun.CryptoHasher("sha256").update(crypto.randomUUID()).digest("hex")
    );
    // Stand-ins for the external ledgers, SMTP and Traefik's published entry point.
    const local = path.join(directory, "local.json");
    const ledger = (name: string) => ({
      image: postgres,
      environment: {
        POSTGRES_USER: "pr0",
        POSTGRES_DB: "ledger",
        POSTGRES_PASSWORD_FILE: "/run/secrets/POSTGRES_PASSWORD",
      },
      secrets: ["POSTGRES_PASSWORD"],
      volumes: [`${name}:/var/lib/postgresql/data`],
      healthcheck: {
        test: ["CMD", "pg_isready", "-U", "pr0", "-d", "ledger"],
        interval: "1s",
        timeout: "2s",
        retries: 60,
      },
    });
    await Bun.write(
      local,
      JSON.stringify({
        services: {
          "ledger-a": ledger("ledger-a"),
          "ledger-b": ledger("ledger-b"),
          smtp: { image: mailpit, ports: [`127.0.0.1:${mailPort}:8025`] },
          ingress: { ports: [`127.0.0.1:${port}:8080`] },
        },
        volumes: { "ledger-a": {}, "ledger-b": {} },
      })
    );
    const settings = {
      COMPOSE_PROJECT_NAME: project,
      COMPOSE_PATH_SEPARATOR: path.delimiter,
      COMPOSE_FILE: ["compose.yaml", "compose.hosted.yaml", slash(local)].join(
        path.delimiter
      ),
      PR0_IMAGE_NAME: imageName,
      ...release(initial),
      PR0_ORIGIN: origin,
      PR0_PUBLIC_HOST: "localhost",
      PR0_REGISTRATION: "allowlist",
      PR0_PROXY_NETWORK: network,
      PR0_INGRESS_TRUSTED_PROXIES: subnet,
      PR0_INGRESS_METRICS_ALLOW: "",
      SMTP_HOST: "smtp",
      SMTP_PORT: "1025",
      SMTP_TLS: "plain",
      SMTP_FROM: "pr0@example.test",
      PR0_SECRET_DIRECTORY: slash(secrets),
      ...Object.fromEntries(
        [
          "POSTGRES_PASSWORD",
          "DATABASE_URL",
          "BETTER_AUTH_SECRET",
          "PR0_MAIL_SECRET",
          "PR0_LEDGER_A_URL",
          "PR0_LEDGER_B_URL",
          "PR0_INGRESS_SECRET",
          "PR0_METRICS_SECRET",
        ].map((name) => [`${name}_FILE`, `/run/secrets/${name}`])
      ),
      PR0_CANARY_PROMPT_ID: canaryPromptId,
      PR0_BACKUP_MOUNT: slash(path.join(directory, "backups")),
      PR0_BACKUP_KEY_PATH: slash(backupKey),
    };
    await Bun.write(
      path.join(checkout, ".env"),
      `# Disposable hosted rehearsal\n${Object.entries(settings)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")}\n`
    );
    await must(
      ["docker", "network", "create", "--subnet", subnet, network],
      root
    );
    networkCreated = true;

    // First deployment, as the hosted runbook describes it.
    deployed = true;
    await compose("build", "web", "accounts", "ingress");
    await compose(
      "up",
      "-d",
      "--wait",
      "database",
      "ledger-a",
      "ledger-b",
      "smtp"
    );
    await compose("run", "--rm", "accounts", "migrate");
    await compose("run", "--rm", "deletions", "initialize");
    await compose("run", "--rm", "restore", "initialize");
    const email = "operator@example.test";
    await compose("run", "--rm", "accounts", "admit-first", email);
    await compose("up", "-d", "--no-build", "--wait", "web", "mail");
    // After web, as the runbook orders it, so the ingress's first lookup finds web.
    await compose("up", "-d", "--no-build", "--wait", "ingress");

    const request = (pathname: string, body?: RequestBody, cookie = "") =>
      fetch(`${origin}${pathname}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
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
        link = detail.Text.match(/http[^\s]+/u)?.[0] ?? "";
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
            promptId: canaryPromptId,
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
    await Bun.write(path.join(secrets, "PR0_CANARY_COOKIE"), cookie);
    expect(await canaryPasses(checkout)).toBe(true);

    await compose("run", "--rm", "backup", "create");

    const redeploy = async (commit: string) => {
      const result = await execute(
        ["bun", "infrastructure/hosted/redeploy.ts", commit],
        checkout
      );
      const events = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => eventSchema.parse(JSON.parse(line)));
      const started = z
        .object({ record: z.string() })
        .safeParse(events.find((event) => event.event === "redeploy_started"));
      if (!started.success) {
        throw new Error(
          `redeploy.ts ${commit} did not start (${result.code}): ${result.stdout}\n${result.stderr.slice(-3000)}`
        );
      }
      const record = recordSchema.parse(
        JSON.parse(await readFile(started.data.record, "utf-8"))
      );
      evidence.push({ commit, exitCode: result.code, events, record });
      return { code: result.code, events, record };
    };
    const running = async () => {
      const services = await compose("ps", "--status", "running", "--services");
      return services
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    };
    const migrationVersion = () =>
      compose(
        "exec",
        "-T",
        "database",
        "psql",
        "-U",
        "pr0",
        "-d",
        "pr0",
        "-tAc",
        "SELECT max(version) FROM migration"
      );
    const canaryPrompt = async () => {
      const response = await request(
        `/api/v1/library/prompts/${canaryPromptId}`,
        undefined,
        cookie
      );
      expect(response.status).toBe(200);
      return z.object({ content: z.string() }).parse(await response.json());
    };
    const imageOf = async (service: string) =>
      z
        .object({ Image: z.string() })
        .parse(JSON.parse(await compose("ps", "--format", "json", service)))
        .Image;
    const expectDeployed = async (commit: string) => {
      const expected = release(commit);
      const environment = await readFile(path.join(checkout, ".env"), "utf-8");
      for (const [name, value] of Object.entries(expected)) {
        expect(environment).toContain(`\n${name}=${value}\n`);
      }
      expect(await git("rev-parse", "HEAD")).toBe(commit);
      expect(await imageOf("web")).toBe(expected.PR0_IMAGE);
      expect(await imageOf("mail")).toBe(expected.PR0_IMAGE);
      expect(await imageOf("ingress")).toBe(expected.PR0_INGRESS_IMAGE);
      const after = await library();
      expect(after.account.id).toBe(before.account.id);
      expect(after.instance.id).toBe(before.instance.id);
      const prompt = await canaryPrompt();
      expect(prompt.content).toBe("probe");
    };

    // A good candidate: every step runs in order and ingress reopens on the new images.
    const upgrade = await redeploy(candidate);
    expect(upgrade.code).toBe(0);
    expect(upgrade.record.status).toBe("complete");
    expect(upgrade.record.previousCommit).toBe(initial);
    expect(upgrade.record.commit).toBe(candidate);
    expect(upgrade.record.steps.map((entry) => entry.step)).toEqual(steps);
    expect(upgrade.record.steps.every((entry) => entry.status === "ok")).toBe(
      true
    );
    expect(upgrade.record.images).toEqual({
      app: { tag: release(candidate).PR0_IMAGE, id: expect.any(String) },
      tools: {
        tag: release(candidate).PR0_TOOLS_IMAGE,
        id: expect.any(String),
      },
      ingress: {
        tag: release(candidate).PR0_INGRESS_IMAGE,
        id: expect.any(String),
      },
    });
    for (const command of upgrade.record.commands) {
      expect(command).not.toMatch(
        /\b(?:initialize|admit-first|restore|down)\b/u
      );
    }
    await expectDeployed(candidate);

    // A failing migration stops the sequence with ingress closed and data intact.
    const failure = await redeploy(broken);
    expect(failure.code).toBe(1);
    expect(failure.record.status).toBe("failed");
    expect(failure.record.steps.map((entry) => entry.step)).toEqual(
      steps.slice(0, 4)
    );
    expect(failure.record.steps.at(-1)?.status).toBe("failed");
    expect(failure.events.at(-1)).toMatchObject({
      event: "redeploy_failed",
      step: "migrate",
    });
    const stopped = await running();
    expect(stopped).toContain("database");
    for (const service of ["ingress", "web", "mail"]) {
      expect(stopped).not.toContain(service);
    }
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

    // Fixing forward with a new commit restores service with the library intact.
    const recovery = await redeploy(fixed);
    expect(recovery.code).toBe(0);
    expect(recovery.record.previousCommit).toBe(broken);
    expect(recovery.record.steps.map((entry) => entry.step)).toEqual(steps);
    expect(await migrationVersion()).toBe("20");
    await expectDeployed(fixed);
    passed = true;
  } finally {
    if (process.env.PR0_HOSTED_EVIDENCE) {
      await Bun.write(
        process.env.PR0_HOSTED_EVIDENCE,
        `${JSON.stringify({ recordedAt: new Date().toISOString(), runs: evidence }, null, 2)}\n`
      );
    }
    try {
      if (deployed && !passed) {
        const logs = await execute(
          ["docker", "compose", "logs", "--no-color", "--tail", "60"],
          checkout
        );
        process.stderr.write(logs.stdout);
      }
      if (deployed) {
        // Only this run's randomly named project, network and image tags.
        await execute(
          ["docker", "compose", "down", "--volumes", "--remove-orphans"],
          checkout
        );
      }
      if (networkCreated) {
        await execute(["docker", "network", "rm", network], root);
      }
      const tags = commits.flatMap((commit) => {
        const { PR0_IMAGE, PR0_TOOLS_IMAGE, PR0_INGRESS_IMAGE } =
          release(commit);
        return [PR0_IMAGE, PR0_TOOLS_IMAGE, PR0_INGRESS_IMAGE];
      });
      if (tags.length) {
        await execute(["docker", "image", "rm", ...tags], root);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 3_600_000);
