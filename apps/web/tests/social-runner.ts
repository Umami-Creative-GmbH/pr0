// oxlint-disable eslint/no-await-in-loop -- Server lifecycle, readiness, and policy transitions must run sequentially.
import path from "node:path";

import { SQL } from "bun";

import { accountEmailLink, cookieFrom, origin, post } from "./http-fixture";
import { githubLogin, libraryFor } from "./social-fixture";

const root = path.resolve(import.meta.dir, "../../..");
const web = path.join(root, "apps/web");
const compose = [
  "docker",
  "compose",
  "-p",
  "pr0-social-26",
  "-f",
  "apps/web/tests/social-compose.yaml",
];
const run = async (command: string[], env: Record<string, string> = {}) => {
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) {
    throw new Error(
      `Acceptance command failed: ${command.slice(0, 3).join(" ")}`
    );
  }
};
let server: ReturnType<typeof Bun.spawn> | undefined;
let mail: ReturnType<typeof Bun.spawn> | undefined;
const stopServer = async () => {
  if (server) {
    server.kill();
    await server.exited;
    server = undefined;
  }
};
const startServer = async (extra: Record<string, string> = {}) => {
  await stopServer();
  server = Bun.spawn(
    [
      "bun",
      "--bun",
      "--preload",
      path.join(import.meta.dir, "social-provider-preload.ts"),
      "node_modules/next/dist/bin/next",
      "start",
      "--port",
      "30426",
    ],
    {
      cwd: web,
      env: {
        ...process.env,
        BUN_OPTIONS: `--preload "${path.join(import.meta.dir, "social-provider-preload.ts").replaceAll("\\", "/")}"`,
        ...extra,
      },
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/v1/ready`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      /* The served production build may still be starting. */
    }
    await Bun.sleep(500);
  }
  throw new Error("The acceptance server did not become ready");
};
try {
  await run([...compose, "up", "-d", "--wait"]);
  await run([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/accounts.ts",
    "migrate",
  ]);
  await run(["bun", "run", "--cwd", "apps/web", "build"]);
  mail = Bun.spawn(
    ["bun", "--conditions=react-server", "scripts/mail-worker.ts"],
    { cwd: web, env: process.env, stdout: "inherit", stderr: "inherit" }
  );
  await startServer();
  await run([
    "bun",
    "test",
    "apps/web/tests/social-integration.test.ts",
    "--timeout",
    "20000",
  ]);
  const subject = crypto.randomUUID();
  const email = `${subject}@example.test`;
  const returning = await githubLogin(subject, email);
  const identity = await libraryFor(cookieFrom(returning));
  const pending = await githubLogin(crypto.randomUUID());
  const Cookie = cookieFrom(pending);
  const pendingEmail = `${crypto.randomUUID()}@example.test`;
  await post("/api/auth/social/email", { email: pendingEmail }, { Cookie });
  const link = await accountEmailLink(pendingEmail);
  const token =
    new URLSearchParams(new URL(link).hash.slice(1)).get("token") ?? "";
  const fixture = {
    PR0_TEST_RETURNING_SUBJECT: subject,
    PR0_TEST_RETURNING_EMAIL: email,
    PR0_TEST_RETURNING_ACCOUNT: identity.account.id,
    PR0_TEST_PENDING_COOKIE: Cookie,
    PR0_TEST_PENDING_TOKEN: token,
  };
  await startServer({ PR0_REGISTRATION: "closed" });
  await run(
    [
      "bun",
      "test",
      "apps/web/tests/social-policy.test.ts",
      "--timeout",
      "20000",
    ],
    { ...fixture, PR0_TEST_SOCIAL_MODE: "closed" }
  );
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  await sql`INSERT INTO registration_admission(email) VALUES ('allowed-social@example.test') ON CONFLICT DO NOTHING`;
  await sql.close();
  await startServer({ PR0_REGISTRATION: "allowlist" });
  await run(
    [
      "bun",
      "test",
      "apps/web/tests/social-policy.test.ts",
      "--timeout",
      "20000",
    ],
    { ...fixture, PR0_TEST_SOCIAL_MODE: "allowlist" }
  );
  await startServer({ PR0_GOOGLE_CLIENT_ID: "", PR0_GITHUB_CLIENT_ID: "" });
  await run(
    [
      "bun",
      "test",
      "apps/web/tests/social-policy.test.ts",
      "--timeout",
      "20000",
    ],
    { PR0_TEST_SOCIAL_MODE: "disabled" }
  );
} finally {
  await stopServer();
  mail?.kill();
  if (mail) {
    await mail.exited;
  }
  await run([...compose, "down", "--volumes"]);
}
