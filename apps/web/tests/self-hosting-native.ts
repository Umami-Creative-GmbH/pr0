// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Native approval, download and persistence checks are an ordered command protocol.
import assert from "node:assert/strict";
import path from "node:path";

import {
  desktopCopyResultSchema,
  desktopCopySchema,
} from "@pr0/api-contract/desktop-copy";
import type { DesktopCopy } from "@pr0/api-contract/desktop-copy";
import { desktopStatusSchema } from "@pr0/api-contract/desktop-session";
import {
  localPromptSchema,
  uploadStatusSchema,
} from "@pr0/api-contract/local-prompts";
import { promptSchema } from "@pr0/api-contract/prompts";
import { downloadStatusSchema } from "@pr0/api-contract/snapshots";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { z } from "zod";

import { runAcceptance } from "./account-test-server";
import { worker } from "./device-native";
import { selfHostingTemplate } from "./self-hosting-browser";
import { selfHostingPassword } from "./self-hosting-fixture";
import type { SelfHostingInstance } from "./self-hosting-fixture";

const approve = async (
  native: ReturnType<typeof worker>,
  page: Page,
  origin: string,
  email: string
) => {
  const begin = await native.command("begin", origin);
  assert.equal(begin.state, "awaiting_approval");
  assert.equal(new URL(native.url()).origin, origin);
  await page.goto(native.url());
  if (await page.getByLabel("Email", { exact: true }).count()) {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(selfHostingPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Approve matching code", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Matching desktop code").inputValue(),
    begin.userCode
  );
  await page
    .getByRole("button", { name: "Approve matching code", exact: true })
    .click();
  let status = await native.command("poll");
  for (
    let attempt = 0;
    status.state !== "signed_in" && attempt < 15;
    attempt += 1
  ) {
    await Bun.sleep(1000);
    status = await native.command("poll");
  }
  assert.equal(status.state, "signed_in");
};

const download = async (native: ReturnType<typeof worker>) => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const status = await native.library(
      "library_download",
      downloadStatusSchema
    );
    if (status.complete) {
      return;
    }
  }
  throw new Error("Native instance download did not complete");
};

const copyOffline = async (
  native: ReturnType<typeof worker>,
  request: DesktopCopy
) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await native.library("library_copy", desktopCopyResultSchema, {
        request,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "Native command failed: clipboard_unavailable" ||
        attempt === 2
      ) {
        throw error;
      }
      // The OS rejected the write; repeat the user's explicit copy activation.
      // A successful write/usage acknowledgement is never repeated.
      await Bun.sleep(100);
    }
  }
  throw new Error("The Windows clipboard remained unavailable");
};

export const verifySelfHostingNative = async (
  instance: SelfHostingInstance,
  peer: SelfHostingInstance,
  email: string,
  promptId: string,
  executable: string
) => {
  await runAcceptance([
    "pwsh",
    "-NoProfile",
    "-File",
    "apps/web/tests/device-certificate.ps1",
    "-Directory",
    instance.directory,
  ]);
  const certificate = path.join(instance.directory, "certificate.pem");
  const cert = await Bun.file(certificate).text();
  const key = await Bun.file(path.join(instance.directory, "key.pem")).text();
  const uploads: string[] = [];
  const ingress = (upstreamOrigin: string) =>
    Bun.serve({
      hostname: "localhost",
      port: 0,
      idleTimeout: 60,
      tls: { cert, key },
      error() {
        // Deliberate upstream outages exercise native offline preservation.
        return new Response("Rehearsal upstream unavailable", { status: 503 });
      },
      async fetch(request) {
        const url = new URL(request.url);
        const headers = new Headers(request.headers);
        headers.delete("accept-encoding");
        const body =
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.text();
        if (url.pathname === "/api/v1/sync/mutations") {
          uploads.push(body ?? "");
        }
        const upstream = await fetch(
          `${upstreamOrigin}${url.pathname}${url.search}`,
          { method: request.method, headers, body, redirect: "manual" }
        );
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
        return new Response(await upstream.arrayBuffer(), {
          status: upstream.status,
          headers: responseHeaders,
        });
      },
    });
  const primaryProxy = ingress(instance.origin);
  const peerProxy = ingress(peer.origin);
  const primaryOrigin = `https://localhost:${primaryProxy.port}`;
  const peerOrigin = `https://localhost:${peerProxy.port}`;
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    locale: "en-US",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const target = `pr0:test:self-hosting:${crypto.randomUUID()}`;
  const state = path.join(instance.directory, "native");
  let native = worker(executable, state, certificate, target);
  try {
    // The disposable SMTP sink stays in local evaluation mode; this stage sends
    // no mail. Only web's canonical origin changes behind the test TLS ingress.
    await instance.configure({
      PR0_ORIGIN: primaryOrigin,
      SMTP_TLS: "starttls",
    });
    await peer.configure({ PR0_ORIGIN: peerOrigin, SMTP_TLS: "starttls" });
    await instance.compose("up", "-d", "--no-build", "web");
    await peer.compose("up", "-d", "--no-build", "web");
    await instance.ready();
    await peer.ready();
    await approve(native, page, primaryOrigin, email);
    await download(native);
    const status = await native.library("status", desktopStatusSchema);
    assert.equal(status.origin, primaryOrigin);
    await instance.compose("stop", "web");
    await native.stop();
    native = worker(executable, state, certificate, target);
    const retained = await native.library("status", desktopStatusSchema);
    assert.equal(retained.accountId, status.accountId);
    const copy = await copyOffline(
      native,
      desktopCopySchema.parse({
        instanceId: retained.instanceId,
        accountId: retained.accountId,
        generation: retained.generation,
        promptId,
        template: selfHostingTemplate,
        values: [
          ["name", "offline"],
          ["count", "42"],
        ],
      })
    );
    assert.equal(copy.usageSaved, true);
    assert.equal(
      await native.library("test_clipboard_text", z.string()),
      "Hello offline, count 42"
    );
    const original = await native.library("library_editor", localPromptSchema, {
      id: promptId,
    });
    await native.library("library_edit", localPromptSchema, {
      request: {
        instanceId: retained.instanceId,
        accountId: retained.accountId,
        generation: retained.generation,
        promptId,
        operationId: crypto.randomUUID(),
        expectedLocalRevision: original.localRevision,
        desired: {
          title: "Offline preserved title",
          description: "",
          content: selfHostingTemplate,
        },
      },
    });
    await instance.compose("up", "-d", "--no-build", "web");
    await instance.ready();
    const uploaded = await native.library("library_upload", uploadStatusSchema);
    assert.equal(uploaded.waiting, 0);
    await native.library("library_sync_usage", z.json());
    await download(native);
    const exact = await native.library("library_detail", promptSchema, {
      id: promptId,
    });
    assert.equal(exact.title, "Offline preserved title");
    assert.equal(exact.content, selfHostingTemplate);
    assert.equal(
      uploads.some((body) => body.includes("Hello offline, count 42")),
      false
    );
    const primarySignOut = await native.command("sign_out");
    assert.equal(primarySignOut.state, "signed_out");
    await approve(native, page, peerOrigin, email);
    await download(native);
    const independent = await native.library("status", desktopStatusSchema);
    assert.notEqual(independent.instanceId, status.instanceId);
    assert.notEqual(independent.accountId, status.accountId);
    const independentPrompts = await native.library(
      "library_browse",
      z.array(promptSchema.pick({ id: true }))
    );
    assert.equal(independentPrompts.length, 0);
    const peerSignOut = await native.command("sign_out");
    assert.equal(peerSignOut.state, "signed_out");
    await approve(native, page, primaryOrigin, email);
    await download(native);
    const returned = await native.library("library_detail", promptSchema, {
      id: promptId,
    });
    assert.equal(returned.title, "Offline preserved title");
    const finalSignOut = await native.command("sign_out");
    assert.equal(finalSignOut.state, "signed_out");
  } finally {
    await native.library("test_clear_credential", z.null());
    await native.stop();
    await browser.close();
    await primaryProxy.stop(true);
    await peerProxy.stop(true);
    await instance.configure({
      PR0_ORIGIN: instance.origin,
      SMTP_TLS: "plain",
    });
    await peer.configure({ PR0_ORIGIN: peer.origin, SMTP_TLS: "plain" });
    await instance.compose("up", "-d", "--no-build", "web");
    await peer.compose("up", "-d", "--no-build", "web");
  }
};
