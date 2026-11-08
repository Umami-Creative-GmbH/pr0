// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Readiness retries preserve the retained disposable deployment.
import assert from "node:assert/strict";
import { realpath, rm } from "node:fs/promises";
import path from "node:path";

import { librarySchema } from "@pr0/api-contract/accounts";
import { z } from "zod";

import type { CapacityServiceInstance } from "./capacity-service-fixture";
import { selfHostingPassword } from "./self-hosting-fixture";

export const resumeCapacityService = async (
  report: string,
  allowCatchUpProgress = false
): Promise<CapacityServiceInstance> => {
  const retained = z
    .object({
      preparedAccounts: z.literal(1000),
      seed: z.string().min(1),
      fixtureLocation: z.object({
        origin: z.url(),
        project: z.string().regex(/^pr0-self-host-[a-f0-9]{8}$/u),
        directory: z.string(),
      }),
    })
    .parse(await Bun.file(report).json());
  const root = path.resolve(import.meta.dir, "../../..");
  const { origin, project } = retained.fixtureLocation;
  const directory = await realpath(retained.fixtureLocation.directory);
  assert.equal(
    path.dirname(directory).toLowerCase(),
    path.join(root, ".scratch").toLowerCase()
  );
  assert.match(path.basename(directory), /^self-hosting-[a-zA-Z0-9]+$/u);
  const url = new URL(origin);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "localhost");
  assert.equal(url.origin, origin);
  const environment = await Bun.file(
    path.join(directory, "instance.env")
  ).text();
  const ingressSecret = environment
    .split("\n")
    .find((entry) => entry.startsWith("PR0_INGRESS_SECRET="))
    ?.slice("PR0_INGRESS_SECRET=".length);
  assert.ok(ingressSecret, "Retained provisioning secret is required");
  const compose = async (...args: string[]) => {
    const child = Bun.spawn(
      [
        "docker",
        "compose",
        "-p",
        project,
        "--env-file",
        path.join(directory, "instance.env"),
        "-f",
        path.join(root, "compose.yaml"),
        "-f",
        path.join(directory, "compose.json"),
        ...args,
      ],
      {
        cwd: root,
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
    assert.equal(code, 0, stderr);
    return stdout;
  };
  const request: CapacityServiceInstance["request"] = (
    pathname,
    body,
    cookie = ""
  ) =>
    fetch(origin + pathname, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  // Recheck the retained primary dataset, not just the report's assertion.
  const counts = await compose(
    "exec",
    "-T",
    "database",
    "psql",
    "-U",
    "pr0",
    "-d",
    "pr0",
    "-At",
    "-c",
    "SELECT count(*)||':'||sum(text_bytes)||':'||sum(prompt_count) FROM library"
  );
  if (allowCatchUpProgress) {
    const [accounts, bytes, prompts] = counts.trim().split(":").map(Number);
    assert.equal(accounts, 1000);
    assert.ok(
      bytes !== undefined &&
        bytes >= 10_737_418_240 &&
        bytes <= 10_737_418_240 + 2 * 10_485_760
    );
    assert.ok(
      prompts !== undefined && prompts >= 109_900 && prompts <= 111_900
    );
  } else {
    assert.equal(counts.trim(), "1000:10737418240:109900");
  }
  return {
    origin,
    project,
    directory,
    compose,
    request,
    seed: () => Promise.resolve(retained.seed),
    async login(email) {
      const match = /^capacity-(?<account>\d+)@example\.test$/u.exec(email);
      const number = Number(match?.groups?.account);
      assert.ok(Number.isInteger(number) && number >= 0 && number < 20);
      const response = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "x-pr0-ingress-secret": ingressSecret,
          "x-pr0-client-ip": `198.19.0.${number + 1}`,
        },
        body: JSON.stringify({ email, password: selfHostingPassword }),
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
      return response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    },
    async library(cookie) {
      const response = await request("/api/v1/library", undefined, cookie);
      assert.equal(response.status, 200);
      return librarySchema.parse(await response.json());
    },
    async ready(expectedStatus = 200) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          const response = await request("/api/v1/ready");
          await response.body?.cancel();
          if (response.status === expectedStatus) {
            return;
          }
        } catch {
          // The restarted container may not have bound its HTTP socket yet.
        }
        await Bun.sleep(500);
      }
      throw new Error("Retained service did not become ready");
    },
    async cleanup() {
      await compose("down", "--volumes", "--remove-orphans");
      await rm(directory, { recursive: true, force: true });
    },
  };
};
