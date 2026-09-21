// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- The native worker is a sequential command stream and polling observes its real clock.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { changeStatusSchema } from "@pr0/api-contract/changes";
import { uploadStatusSchema } from "@pr0/api-contract/local-prompts";
import { promptSchema } from "@pr0/api-contract/prompts";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { z } from "zod";

import { runAcceptance } from "./account-test-server";
import type { accountTestServer } from "./account-test-server";
import { verifyNativeChanges } from "./changes-native";
import { verifiedBrowser } from "./device-fixture";
import { origin, password } from "./http-fixture";
import type { NativeArgs } from "./local-native-worker";
import { seedDownloadCapacity } from "./snapshot-capacity-fixture";
import { verifyNativeUploads } from "./uploads-native";
import { verifyNativeUsage } from "./usage-native";

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
          const result = z
            .union([z.object({ Ok: z.json() }), z.object({ Err: z.string() })])
            .parse(
              JSON.parse(
                line.slice(line.indexOf("PR0_RESULT:") + "PR0_RESULT:".length)
              )
            );
          if ("Err" in result) {
            throw new Error(`Native command failed: ${result.Err}`);
          }
          return result.Ok;
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
        return resultSchema.parse({ Ok: await read() }).Ok;
      } finally {
        clearTimeout(timer);
      }
    },
    url: () => browserUrl,
    async library<T>(
      command: string,
      schema: z.ZodType<T>,
      args: NativeArgs = {}
    ) {
      nativeProcess.stdin.write(`${JSON.stringify({ command, ...args })}\n`);
      await nativeProcess.stdin.flush();
      const timer = setTimeout(() => nativeProcess.kill(), 120_000);
      try {
        return schema.parse(await read());
      } finally {
        clearTimeout(timer);
      }
    },
    async stop() {
      nativeProcess.stdin.write('{"command":"quit"}\n');
      await nativeProcess.stdin.end();
      assert.equal(await nativeProcess.exited, 0);
    },
  };
};

const verifyNativePeerChanges = async ({
  executable,
  directory,
  certificate,
  target,
  page,
  selectedOrigin,
  native,
}: {
  executable: string;
  directory: string;
  certificate: string;
  target: string;
  page: Page;
  selectedOrigin: string;
  native: ReturnType<typeof worker>;
}) => {
  const peer = worker(
    executable,
    path.join(directory, "peer"),
    certificate,
    `${target}:peer`
  );
  try {
    await peer.command("begin", selectedOrigin);
    await page.goto(peer.url());
    await page.getByRole("button", { name: "Approve matching code" }).click();
    await page
      .getByText("Desktop approved. Return to pr0 on your computer.")
      .waitFor();
    let peerStatus = await peer.command("poll");
    for (
      let attempt = 0;
      peerStatus.state !== "signed_in" && attempt < 12;
      attempt += 1
    ) {
      await Bun.sleep(1000);
      peerStatus = await peer.command("poll");
    }
    assert.equal(peerStatus.state, "signed_in");
    await verifyNativeChanges({
      commands: [
        (command, args = {}) => native.library(command, z.json(), args),
        (command, args = {}) => peer.library(command, z.json(), args),
      ],
      page,
      origin: selectedOrigin,
    });
  } finally {
    await peer.command("sign_out");
    await peer.stop();
  }
};

const verifyNativeSuspension = async (
  native: ReturnType<typeof worker>,
  accountId: string
) => {
  const before = await native.library(
    "library_browse",
    z.array(z.object({ id: z.string(), title: z.string() }))
  );
  assert.ok(before.length > 0);
  await runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/accounts.ts",
    "suspend",
    accountId,
  ]);
  try {
    const suspended = await native.library(
      "library_changes",
      changeStatusSchema
    );
    assert.equal(suspended.error, "account_suspended");
    assert.deepEqual(
      await native.library(
        "library_browse",
        z.array(z.object({ id: z.string(), title: z.string() }))
      ),
      before
    );
  } finally {
    await runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/accounts.ts",
      "resume",
      accountId,
    ]);
  }
  process.stdout.write(
    "PASS native HTTPS suspension is explicit and retains downloaded prompts\n"
  );
};

export const verifyNativeHttps = async (
  server: ReturnType<typeof accountTestServer>,
  scenarios: {
    download?: boolean;
    upload?: boolean;
    usage?: boolean;
    live?: boolean;
    operations?: boolean;
  } = {}
) => {
  const { download, upload, usage, live, operations } = scenarios;
  const account = await verifiedBrowser();
  if (download) {
    await seedDownloadCapacity(account.library);
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr0-device-live-"));
  const selectedOrigin =
    process.env.PR0_TEST_NATIVE_ORIGIN ?? "https://localhost:30440";
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
  let loseNextUpload = false;
  const traffic: { path: string; body: string }[] = [];
  const proxy = Bun.serve({
    hostname: "localhost",
    port: Number(new URL(selectedOrigin).port),
    idleTimeout: 60,
    tls: {
      cert: Bun.file(certificate),
      key: Bun.file(path.join(directory, "key.pem")),
    },
    async fetch(request) {
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete("accept-encoding");
      const body =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.text();
      if (
        url.pathname === "/api/v1/sync/mutations" ||
        url.pathname === "/api/v1/sync/receipts"
      ) {
        traffic.push({ path: url.pathname, body: body ?? "" });
      }
      const upstream = await fetch(`${origin}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      if (loseNextUpload && url.pathname === "/api/v1/sync/mutations") {
        loseNextUpload = false;
        await upstream.arrayBuffer();
        return new Response("Acknowledgement intentionally lost", {
          status: 502,
        });
      }
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
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "chrome",
    headless: true,
  });
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
    const downloadStatus = z.object({
      complete: z.boolean(),
      downloaded: z.number(),
      total: z.number(),
      appliedPages: z.number(),
      totalPages: z.number(),
    });
    let started = 0;
    if (download) {
      started = performance.now();
      const partial = await native.library("library_download", downloadStatus);
      assert.equal(partial.complete, false);
      assert.ok(partial.downloaded > 0 && partial.downloaded < 10_000);
    }
    await native.stop();
    native = worker(
      executable,
      path.join(directory, "state"),
      certificate,
      target
    );
    const restored = await native.command("status");
    assert.equal(restored.state, "signed_in");
    if (download) {
      let progress = await native.library("library_status", downloadStatus);
      assert.ok(progress.downloaded > 0);
      while (!progress.complete) {
        progress = await native.library("library_download", downloadStatus);
      }
      assert.equal(progress.downloaded, 10_000);
      const first = await native.library(
        "library_browse",
        z.array(z.object({ id: z.string(), title: z.string() }))
      );
      const last = await native.library(
        "library_browse",
        z.array(z.object({ id: z.string(), title: z.string() })),
        { offset: 9950 }
      );
      assert.equal(last.length, 50);
      assert.ok(first[0]);
      await server.stopServer();
      await native.stop();
      native = worker(
        executable,
        path.join(directory, "state"),
        certificate,
        target
      );
      const offline = await native.library("library_detail", promptSchema, {
        id: first[0].id,
      });
      assert.equal(offline.title, "Capacity");
      assert.ok(offline.content.length >= 10_477);
      const elapsedMs = performance.now() - started;
      const files = [
        ...new Bun.Glob("*.sqlite*").scanSync(path.join(directory, "state")),
      ];
      const sizes = await Promise.all(
        files.map(async (name) => {
          const metadata = await Bun.file(
            path.join(directory, "state", name)
          ).stat();
          return { name, bytes: metadata.size };
        })
      );
      process.stdout.write(
        `SNAPSHOT_COST ${JSON.stringify({ prompts: 10_000, logicalBytes: 104_857_600, pages: progress.totalPages, elapsedMs, files: sizes })}\n`
      );
      assert.ok(elapsedMs < 120_000);
      await server.startServer({
        PR0_ORIGIN: selectedOrigin,
        SMTP_TLS: "starttls",
      });
    }
    if (upload) {
      await verifyNativeUploads({
        command: (command, args = {}) =>
          native.library(command, z.json(), args),
        restart: async () => {
          await native.stop();
          native = worker(
            executable,
            path.join(directory, "state"),
            certificate,
            target
          );
          await native.command("status");
        },
        lose: () => {
          loseNextUpload = true;
        },
        traffic,
        page,
        origin: selectedOrigin,
      });
      const uploadStatus = await native.library(
        "library_upload_status",
        uploadStatusSchema
      );
      assert.equal(uploadStatus.waiting, 0);
    }
    if (live) {
      await verifyNativePeerChanges({
        executable,
        directory,
        certificate,
        target,
        page,
        selectedOrigin,
        native,
      });
    }
    if (usage) {
      await verifyNativeUsage({
        command: (name, args = {}) => native.library(name, z.json(), args),
        restart: async () => {
          await native.stop();
          native = worker(
            executable,
            path.join(directory, "state"),
            certificate,
            target
          );
          await native.command("status");
        },
        lose: () => {
          loseNextUpload = true;
        },
        traffic,
        page,
        origin: selectedOrigin,
      });
    }
    if (operations) {
      await verifyNativeSuspension(native, account.library.account.id);
    }
    const refreshed = await native.command("refresh");
    assert.equal(refreshed.state, "signed_in");
    const signedOut = await native.command("sign_out");
    assert.equal(signedOut.state, "signed_out");
    process.stdout.write(
      "PASS Rust HTTPS → browser email approval → Windows Credential Manager → new native process → authenticated refresh → independent sign-out\n"
    );
  } finally {
    try {
      await native.command("sign_out");
    } catch {
      // A failed preservation test can intentionally leave pending work. Remove only its disposable credential.
      await native.library("test_clear_credential", z.null());
    } finally {
      await native.stop();
    }
    await browser.close();
    await proxy.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
};
