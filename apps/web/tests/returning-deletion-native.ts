import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";

import {
  deletionVerificationPageSchema,
  deletionVerificationSchema,
} from "@pr0/api-contract/deletions";
import { desktopStatusSchema } from "@pr0/api-contract/desktop-session";
import { localPromptSchema } from "@pr0/api-contract/local-prompts";
import type { Page } from "playwright";
import { z } from "zod";

import { runAcceptance } from "./account-test-server";
import type { worker } from "./device-native";
import { password } from "./http-fixture";
import type { NativeArgs } from "./local-native-worker";

export const verifyReturningDeletion = async ({
  native,
  page,
  origin,
  directory,
  traffic,
}: {
  native: ReturnType<typeof worker>;
  page: Page;
  origin: string;
  directory: string;
  traffic: { path: string; body: string }[];
}) => {
  const identity = await native.library("status", desktopStatusSchema);
  await native.library("library_download", z.json());
  const saved = await native.library("library_create", localPromptSchema, {
    request: {
      instanceId: identity.instanceId,
      accountId: identity.accountId,
      generation: identity.generation,
      operationId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
      expectedLocalRevision: null,
      desired: {
        title: "Pending deletion fixture",
        description: "",
        content: "Retained offline work",
      },
    },
  });
  const desktop = await page.context().newPage();
  let queue = Promise.resolve();
  await desktop.exposeFunction(
    "nativeCommand",
    async (command: string, args: NativeArgs) => {
      const previous = queue;
      const done = Promise.withResolvers<undefined>();
      queue = done.promise;
      await previous;
      try {
        const names = new Map([
          ["auth_status", "status"],
          ["auth_refresh", "refresh"],
        ]);
        return {
          ok: await native.library(
            names.get(command) ?? command,
            z.json(),
            args
          ),
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "native_unavailable",
        };
      } finally {
        done.resolve();
      }
    }
  );
  await desktop.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
      value: {
        unregisterListener: () => {
          /* This bridge delivers command responses only. */
        },
      },
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: NativeArgs = {}) => {
          if (command.startsWith("plugin:event|")) {
            return 1;
          }
          const result = await window.nativeCommand(command, args);
          if (result.error) {
            throw result.error;
          }
          return result.ok;
        },
        transformCallback: () => 1,
      },
    });
  });
  await desktop.goto("http://localhost:1420");
  await desktop
    .getByRole("button", { name: "New prompt", exact: true })
    .click();
  await desktop
    .getByLabel("Content", { exact: true })
    .fill("Transient unsaved account text");
  // This desktop remains on its initial pinned key while the real service rotates twice.
  await runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/deletions.ts",
    "rotate",
  ]);
  await runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/deletions.ts",
    "rotate",
  ]);
  const post = (path: string, data: NativeArgs) =>
    page
      .context()
      .request.post(`${origin}${path}`, { data, headers: { Origin: origin } });
  const verification = await page
    .context()
    .request.get(`${origin}/api/v1/account-deletions/verification?page=0`);
  const continuity = deletionVerificationPageSchema.parse(
    await verification.json()
  );
  assert.equal(continuity.rotations.length, 2);
  assert.equal(continuity.nextPage, null);
  const legacy = await page
    .context()
    .request.get(`${origin}/api/v1/account-deletions/verification`);
  assert.equal(
    deletionVerificationSchema.parse(await legacy.json()).rotations.length,
    2
  );
  const invalidPage = await page
    .context()
    .request.get(`${origin}/api/v1/account-deletions/verification?page=-1`);
  assert.equal(invalidPage.status(), 400);
  const fresh = await post("/api/v1/account/reauth/verify", {
    accountId: identity.accountId,
    emailVersion: 0,
    password,
  });
  assert.equal(fresh.status(), 200, await fresh.text());
  const deleted = await post("/api/v1/account/deletion", {
    accountId: identity.accountId,
    emailVersion: 0,
    confirmation: "delete-account",
  });
  assert.equal(deleted.status(), 200, await deleted.text());
  // The UI drives the real Rust HTTPS receipt lookup, signature verification and cleanup.
  await desktop.getByRole("button", { name: "Check connection" }).click();
  await desktop.getByRole("heading", { name: "Sign in to pr0" }).waitFor();
  assert.equal(await desktop.getByLabel("Content", { exact: true }).count(), 0);
  assert.equal(
    await desktop
      .getByText("Pending deletion fixture", { exact: true })
      .count(),
    0
  );
  const finalStatus = await native.library("status", desktopStatusSchema);
  assert.equal(finalStatus.state, "signed_out");
  assert.equal(
    traffic.length,
    0,
    "Queued edits must never be sent after deletion"
  );
  await assert.rejects(
    native.library("library_detail", z.json(), { id: saved.prompt.id })
  );
  const files = await readdir(directory);
  assert.deepEqual(
    files.filter((name) => name.startsWith("library-")),
    []
  );
  await desktop.screenshot({
    path: "docs/evidence/issue-57-native-deletion.png",
    fullPage: true,
  });
  await desktop.close();
  process.stdout.write(
    "PASS Returning desktop: two rotations → real signed receipt → Rust verification → exact cleanup → draft invalidation → zero uploads\n"
  );
};
