// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- The native worker is a sequential command stream and polling observes its real clock.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import { z } from "zod";

import { runAcceptance } from "./account-test-server";
import type { accountTestServer } from "./account-test-server";
import { verifiedBrowser } from "./device-fixture";
import { origin, password } from "./http-fixture";

const resultSchema = z.object({
  Ok: z.object({
    state: z.string(),
    userCode: z.string().nullable(),
    accountId: z.string().nullable(),
    message: z.string(),
  }),
});
const worker = (
  executable: string,
  directory: string,
  certificate: string,
  target: string
) => {
  const nativeProcess = Bun.spawn(
    [executable, "--exact", "auth_tests::live_https_worker", "--nocapture"],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env: {
        ...process.env,
        PR0_TEST_LIVE_PATH: directory,
        PR0_TEST_CERTIFICATE: certificate,
        PR0_TEST_CREDENTIAL_TARGET: target,
      },
    }
  );
  const reader = nativeProcess.stdout.getReader();
  let buffer = "";
  let browserUrl = "";
  const decoder = new TextDecoder();
  const read = async () => {
    while (true) {
      const end = buffer.indexOf("\n");
      if (end === -1) {
        const result = await reader.read();
        if (result.done) {
          throw new Error("Native acceptance worker ended before replying");
        }
        buffer += decoder.decode(result.value, { stream: true });
      } else {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line.includes("PR0_BROWSER:")) {
          browserUrl = line.slice(
            line.indexOf("PR0_BROWSER:") + "PR0_BROWSER:".length
          );
        }
        if (line.includes("PR0_RESULT:")) {
          return resultSchema.parse(
            JSON.parse(
              line.slice(line.indexOf("PR0_RESULT:") + "PR0_RESULT:".length)
            )
          ).Ok;
        }
      }
    }
  };
  return {
    async command(command: string, selectedOrigin?: string) {
      nativeProcess.stdin.write(
        `${JSON.stringify({ command, origin: selectedOrigin })}\n`
      );
      await nativeProcess.stdin.flush();
      const timer = setTimeout(() => nativeProcess.kill(), 30_000);
      try {
        return await read();
      } finally {
        clearTimeout(timer);
      }
    },
    url: () => browserUrl,
    async stop() {
      nativeProcess.stdin.write('{"command":"quit"}\n');
      await nativeProcess.stdin.end();
      assert.equal(await nativeProcess.exited, 0);
    },
  };
};

export const verifyNativeHttps = async (
  server: ReturnType<typeof accountTestServer>
) => {
  const account = await verifiedBrowser();
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-device-live-"));
  const selectedOrigin = "https://localhost:30440";
  const certificate = path.join(directory, "certificate.pem");
  await runAcceptance([
    "pwsh",
    "-NoProfile",
    "-File",
    "apps/web/tests/device-certificate.ps1",
    "-Directory",
    directory,
  ]);
  const build = Bun.spawn(
    [
      "cargo",
      "test",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "--lib",
      "--no-run",
      "--message-format=json",
    ],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "inherit",
    }
  );
  const output = await new Response(build.stdout).text();
  assert.equal(await build.exited, 0);
  const artifact = z.object({
    reason: z.literal("compiler-artifact"),
    executable: z.string(),
  });
  const artifacts = output
    .trim()
    .split("\n")
    .map((line) => artifact.safeParse(JSON.parse(line)));
  const executable = artifacts.find((value) => value.success)?.data?.executable;
  assert.ok(executable);
  const proxy = Bun.serve({
    hostname: "localhost",
    port: 30_440,
    tls: {
      cert: Bun.file(certificate),
      key: Bun.file(path.join(directory, "key.pem")),
    },
    async fetch(request) {
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete("accept-encoding");
      const upstream = await fetch(`${origin}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.arrayBuffer(),
        redirect: "manual",
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers: responseHeaders,
      });
    },
  });
  const target = `pr0:test:39:${crypto.randomUUID()}`;
  let native = worker(
    executable,
    path.join(directory, "state"),
    certificate,
    target
  );
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await server.startServer({
      PR0_ORIGIN: selectedOrigin,
      SMTP_TLS: "starttls",
    });
    const begin = await native.command("begin", selectedOrigin);
    assert.equal(begin.state, "awaiting_approval");
    assert.equal(
      native.url(),
      `${selectedOrigin}/device?user_code=${begin.userCode}`
    );
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(native.url());
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const approve = page.getByRole("button", { name: "Approve matching code" });
    await approve.waitFor();
    assert.equal(
      await page.getByLabel("Matching desktop code").inputValue(),
      begin.userCode
    );
    await approve.click();
    await page
      .getByText("Desktop approved. Return to pr0 on your computer.")
      .waitFor();
    let status = await native.command("poll");
    for (
      let attempt = 0;
      status.state !== "signed_in" && attempt < 12;
      attempt += 1
    ) {
      await Bun.sleep(1000);
      status = await native.command("poll");
    }
    assert.equal(status.state, "signed_in");
    assert.equal(status.accountId, account.library.account.id);
    await native.stop();
    native = worker(
      executable,
      path.join(directory, "state"),
      certificate,
      target
    );
    const restored = await native.command("status");
    assert.equal(restored.state, "signed_in");
    const refreshed = await native.command("refresh");
    assert.equal(refreshed.state, "signed_in");
    const signedOut = await native.command("sign_out");
    assert.equal(signedOut.state, "signed_out");
    process.stdout.write(
      "PASS Rust HTTPS → Chrome email approval → Windows Credential Manager → new native process → authenticated refresh → independent sign-out\n"
    );
  } finally {
    try {
      await native.command("sign_out");
    } finally {
      await native.stop();
    }
    await browser.close();
    await proxy.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
};
