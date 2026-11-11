// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Compose transitions and readiness polls advance a disposable deployment sequentially.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { librarySchema } from "@pr0/api-contract/accounts";
import { z } from "zod";

import { availablePort } from "./test-network";

const root = path.resolve(import.meta.dir, "../../..");
export const selfHostingPassword = "disposable-self-host-password";
interface SelfHostingSettings extends Record<string, string> {
  PR0_IMAGE: string;
  PR0_TOOLS_IMAGE: string;
  PR0_ORIGIN: string;
  PR0_BACKUP_KEY_PATH: string;
}
interface ComposeService {
  image?: string;
  platform?: string;
  environment?: Record<string, string>;
  secrets?: string[];
  volumes?: string[];
  ports?: string[];
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}
type RequestBody = z.infer<ReturnType<typeof z.json>>;
// Extra Compose files layered after the disposable override, e.g. an ingress.
export const selfHostingFixture = async (composeFiles: string[] = []) => {
  await mkdir(path.join(root, ".scratch"), { recursive: true });
  const directory = await mkdtemp(path.join(root, ".scratch/self-hosting-"));
  const project = `pr0-self-host-${crypto.randomUUID().slice(0, 8)}`;
  const envFile = path.join(directory, "instance.env");
  const override = path.join(directory, "compose.json");
  const port = await availablePort();
  const mailPort = await availablePort();
  const origin = `http://localhost:${port}`;
  await mkdir(path.join(directory, "backups"));
  const password = crypto.randomUUID();
  const secretValues = {
    POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgres://pr0:${password}@database:5432/pr0`,
    BETTER_AUTH_SECRET: `${crypto.randomUUID()}-${crypto.randomUUID()}`,
    PR0_MAIL_SECRET: `${crypto.randomUUID()}-${crypto.randomUUID()}`,
  };
  const settings: SelfHostingSettings = {
    PR0_IMAGE: process.env.PR0_SELF_HOST_IMAGE ?? "pr0-self-host-62",
    PR0_TOOLS_IMAGE:
      process.env.PR0_SELF_HOST_TOOLS_IMAGE ?? "pr0-self-host-tools-62",
    PR0_PORT: String(port),
    PR0_BIND_ADDRESS: "127.0.0.1",
    PR0_ORIGIN: origin,
    PR0_REGISTRATION: "closed",
    SMTP_HOST: "smtp",
    SMTP_PORT: "1025",
    SMTP_TLS: "plain",
    SMTP_FROM: "pr0@example.test",
    PR0_BACKUP_MOUNT: path.join(directory, "backups").replaceAll("\\", "/"),
    PR0_BACKUP_KEY_PATH: path
      .join(directory, "backup-key")
      .replaceAll("\\", "/"),
    PR0_BACKUP_RELEASE: "self-hosting-rehearsal-62",
  };
  const secrets: Record<string, { file: string }> = {};
  for (const [name, value] of Object.entries(secretValues)) {
    const file = path.join(directory, name);
    await Bun.write(file, value);
    secrets[name] = { file };
    settings[`${name}_FILE`] = `/run/secrets/${name}`;
  }
  await Bun.write(
    settings.PR0_BACKUP_KEY_PATH,
    new Bun.CryptoHasher("sha256").update(crypto.randomUUID()).digest("hex")
  );
  const mounts = Object.keys(secretValues).filter(
    (name) => name !== "POSTGRES_PASSWORD"
  );
  const services: Record<string, ComposeService> = {};
  for (const name of [
    "web",
    "mail",
    "accounts",
    "deletions",
    "restore",
    "backup",
    "operations",
  ]) {
    services[name] = { secrets: mounts };
  }
  services.database = { secrets: ["POSTGRES_PASSWORD"] };
  services.smtp = {
    image:
      "axllent/mailpit@sha256:030f06031ce5c60913ac9363da1ab0d4be6fd2a78147dd0e1ca0fcac665d6b34",
    ports: [`127.0.0.1:${mailPort}:8025`],
  };
  if (process.env.PR0_SELF_HOST_PLATFORM) {
    for (const service of Object.values(services)) {
      service.platform = process.env.PR0_SELF_HOST_PLATFORM;
    }
  }
  await Bun.write(override, JSON.stringify({ services, secrets }));
  const configure = async (extra: Record<string, string> = {}) => {
    Object.assign(settings, extra);
    await Bun.write(
      envFile,
      Object.entries(settings)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")
    );
  };
  await configure();
  let started = false;
  const run = async (args: string[], input?: string) => {
    const child = Bun.spawn(
      [
        "docker",
        "compose",
        "--profile",
        "operations",
        "--project-name",
        project,
        "--env-file",
        envFile,
        "-f",
        path.join(root, "compose.yaml"),
        "-f",
        override,
        ...composeFiles.flatMap((file) => ["-f", file]),
        ...args,
      ],
      {
        cwd: root,
        stdin: input === undefined ? "ignore" : new Blob([input]),
        stdout: "pipe",
        stderr: "pipe",
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) =>
              !/^(?:PR0_|SMTP_|DATABASE_URL|BETTER_AUTH_|POSTGRES_)/u.test(name)
          )
        ),
      }
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) {
      throw new Error(
        `Compose ${args.slice(0, 3).join(" ")} failed (${code}): ${stderr}\n${stdout}`
      );
    }
    return stdout;
  };
  const compose = (...args: string[]) => run(args);
  /** Runs a Compose command with `input` on stdin (use `run -T`). */
  const composeInput = (input: string, ...args: string[]) => run(args, input);
  const request = (pathname: string, body?: RequestBody, cookie = "") =>
    fetch(`${origin}${pathname}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: settings.PR0_ORIGIN,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
  const ready = async (expectedStatus = 200) => {
    let last = "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await request("/api/v1/ready");
        last = await response.text();
        if (response.status === expectedStatus) {
          return;
        }
      } catch {
        /* The container is still starting. */
      }
      await Bun.sleep(300);
    }
    throw new Error(`Production Compose did not become ready: ${last}`);
  };
  return {
    directory,
    project,
    origin,
    mailOrigin: `http://localhost:${mailPort}`,
    settings,
    compose,
    composeInput,
    configure,
    request,
    ready,
    async initialize(email: string) {
      started = true;
      await compose("up", "-d", "--wait", "database", "smtp");
      await compose("run", "--rm", "accounts", "migrate");
      await compose("run", "--rm", "restore", "initialize");
      await compose("run", "--rm", "accounts", "admit-first", email);
      await compose("up", "-d", "--no-build", "web", "mail");
      await ready();
    },
    async login(email: string) {
      const response = await request("/api/auth/sign-in/email", {
        email,
        password: selfHostingPassword,
      });
      assert.equal(response.status, 200, await response.text());
      return response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    },
    async library(cookie: string) {
      const response = await request("/api/v1/library", undefined, cookie);
      assert.equal(response.status, 200, await response.clone().text());
      return librarySchema.parse(await response.json());
    },
    async verificationLink(email: string) {
      const mailOrigin = `http://localhost:${mailPort}`;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const messages = await fetch(`${mailOrigin}/api/v1/messages`);
        const list = z
          .object({
            messages: z.array(
              z.object({
                ID: z.string(),
                To: z.array(z.object({ Address: z.string() })),
              })
            ),
          })
          .parse(await messages.json());
        const item = list.messages.find((message) =>
          message.To.some((recipient) => recipient.Address === email)
        );
        if (item) {
          const detail = await fetch(`${mailOrigin}/api/v1/message/${item.ID}`);
          const message = z
            .object({ Text: z.string() })
            .parse(await detail.json());
          const link = message.Text.match(/http[^\s]+/u)?.[0];
          if (link) {
            return link;
          }
        }
        await Bun.sleep(250);
      }
      throw new Error("Verification did not reach the disposable SMTP sink");
    },
    async cleanup() {
      try {
        if (started) {
          await compose("down", "--volumes", "--remove-orphans");
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
};
export type SelfHostingInstance = Awaited<
  ReturnType<typeof selfHostingFixture>
>;
