// oxlint-disable eslint/no-await-in-loop -- Readiness polling and server lifecycle transitions are sequential.
import path from "node:path";

import { origin } from "./http-fixture";

const root = path.resolve(import.meta.dir, "../../..");
const web = path.join(root, "apps/web");
export const runAcceptance = async (
  command: string[],
  env: Record<string, string> = {}
) => {
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
export const accountTestServer = (
  project: string,
  composeFile = "apps/web/tests/social-compose.yaml"
) => {
  const compose = ["docker", "compose", "-p", project, "-f", composeFile];
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let mail: ReturnType<typeof Bun.spawn> | undefined;
  const stopServer = async () => {
    if (server) {
      server.kill();
      await server.exited;
      server = undefined;
    }
  };
  const startServer = async (
    extra: Record<string, string> = {},
    preloads: string[] = []
  ) => {
    await stopServer();
    server = Bun.spawn(
      [
        "bun",
        "--bun",
        "--preload",
        path.join(import.meta.dir, "social-provider-preload.ts"),
        ...preloads.flatMap((file) => ["--preload", file]),
        "node_modules/next/dist/bin/next",
        "start",
        "--port",
        new URL(origin).port,
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
  const setup = async () => {
    await runAcceptance([...compose, "up", "-d", "--wait"]);
    await runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/accounts.ts",
      "migrate",
    ]);
    await runAcceptance(["bun", "run", "--cwd", "apps/web", "build"]);
    mail = Bun.spawn(
      ["bun", "--conditions=react-server", "scripts/mail-worker.ts"],
      { cwd: web, env: process.env, stdout: "inherit", stderr: "inherit" }
    );
    await startServer();
  };
  const cleanup = async () => {
    await stopServer();
    mail?.kill();
    if (mail) {
      await mail.exited;
    }
    await runAcceptance([...compose, "down", "--volumes"]);
  };
  return { setup, cleanup, startServer };
};
