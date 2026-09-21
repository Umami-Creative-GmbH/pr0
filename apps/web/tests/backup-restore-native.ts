// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- The native recovery journey advances one durable command at a time.
import assert from "node:assert/strict";

import { librarySchema } from "@pr0/api-contract/accounts";
import { desktopStatusSchema } from "@pr0/api-contract/desktop-session";
import {
  localPromptSchema,
  uploadStatusSchema,
} from "@pr0/api-contract/local-prompts";
import {
  recoverySummariesSchema,
  downloadStatusSchema,
} from "@pr0/api-contract/snapshots";
import { z } from "zod";

import type { accountTestServer } from "./account-test-server";
import {
  backupCommand,
  restoreCommand,
  resetRehearsalDatabase,
} from "./backup-restore-fixture";
import { verifyNativeHttps } from "./device-native";
import { password } from "./http-fixture";
import { promptOperation } from "./prompt-fixture";

export const rehearseNativeRestore = (
  server: ReturnType<typeof accountTestServer>
) =>
  verifyNativeHttps(server, {
    afterSession: async ({ native, page, origin, traffic }) => {
      const response = await page.request.get(`${origin}/api/v1/library`);
      const library = librarySchema.parse(await response.json());
      const retained = promptOperation({
        title: "Before checkpoint",
        description: "",
        content: "Acknowledged before checkpoint",
      });
      const lost = promptOperation({
        title: "After checkpoint",
        description: "",
        content: "Acknowledged after checkpoint",
      });
      const mutate = async (operation: ReturnType<typeof promptOperation>) => {
        const result = await page.request.post(
          `${origin}/api/v1/sync/mutations`,
          {
            headers: { Origin: origin },
            data: {
              protocolVersion: 1,
              instanceId: library.instance.id,
              accountId: library.account.id,
              epoch: library.epoch,
              installationId: crypto.randomUUID(),
              operations: [operation],
            },
          }
        );
        assert.equal(result.status(), 200);
      };
      const download = async () => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const result = await native.library(
            "library_download",
            downloadStatusSchema
          );
          if (result.complete) {
            return;
          }
        }
        throw new Error("Native snapshot did not complete");
      };
      await mutate(retained);
      const checkpoint = await backupCommand("create");
      await mutate(lost);
      await download();
      const status = await native.library("status", desktopStatusSchema);
      const original = await native.library(
        "library_editor",
        localPromptSchema,
        { id: retained.promptId }
      );
      const pendingId = crypto.randomUUID();
      await native.library("library_edit", localPromptSchema, {
        request: {
          instanceId: status.instanceId,
          accountId: status.accountId,
          generation: status.generation,
          operationId: pendingId,
          promptId: retained.promptId,
          expectedLocalRevision: original.localRevision,
          desired: {
            title: "Before checkpoint",
            description: "",
            content: "Pending exact offline edit",
          },
        },
      });
      await restoreCommand("close");
      await server.stopServer();
      await server.stopMail();
      await restoreCommand("seal");
      await resetRehearsalDatabase();
      await backupCommand("restore", checkpoint.archive);
      process.env.BETTER_AUTH_SECRET = `native-recovery-${crypto.randomUUID()}-${crypto.randomUUID()}`;
      await restoreCommand("prepare");
      server.startMail();
      await server.startServer(
        { PR0_ORIGIN: origin, SMTP_TLS: "starttls" },
        false
      );
      await backupCommand("create");
      await restoreCommand("open");
      traffic.length = 0;
      await assert.rejects(
        native.command("refresh"),
        /authentication_required/u
      );
      const expired = await native.command("status");
      assert.equal(expired.state, "authentication_required");
      const preserved = await native.library(
        "library_editor",
        localPromptSchema,
        { id: retained.promptId }
      );
      assert.equal(preserved.prompt.content, "Pending exact offline edit");
      assert.equal(
        traffic.filter((entry) => entry.path.endsWith("/mutations")).length,
        0
      );

      const begin = await native.command("begin", origin);
      assert.equal(begin.state, "awaiting_approval");
      await page.goto(native.url());
      await page
        .getByLabel("Email", { exact: true })
        .fill(library.account.email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Approve matching code" }).click();
      let approved = await native.command("poll");
      for (
        let attempt = 0;
        approved.state !== "signed_in" && attempt < 12;
        attempt += 1
      ) {
        await Bun.sleep(1000);
        approved = await native.command("poll");
      }
      assert.equal(approved.state, "signed_in");
      await download();
      const archived = await native.library(
        "library_recovery_browse",
        recoverySummariesSchema,
        { offset: 0 }
      );
      assert.ok(archived.some((entry) => entry.promptId === lost.promptId));
      const quarantined = await native.library(
        "library_upload",
        uploadStatusSchema
      );
      assert.ok(
        quarantined.errors.some(
          (entry) =>
            entry.promptId === retained.promptId &&
            entry.code === "recovery_required"
        )
      );
      const retainedEdit = await native.library(
        "library_editor",
        localPromptSchema,
        { id: retained.promptId }
      );
      assert.equal(retainedEdit.pending, true);
      assert.equal(retainedEdit.prompt.content, "Pending exact offline edit");
      await download();
      const uploads = traffic
        .filter((entry) => entry.path.endsWith("/mutations"))
        .flatMap(
          (entry) =>
            z
              .object({
                operations: z.array(
                  z.object({ operationId: z.string(), promptId: z.string() })
                ),
              })
              .parse(JSON.parse(entry.body)).operations
        );
      assert.equal(uploads.length, 0);
      const result = {
        measuredAt: new Date().toISOString(),
        windowsCredentialRevoked: true,
        reauthenticationBeforeUpload: true,
        pendingEditPreserved: true,
        pendingEditRequiresRecoveryReview: true,
        lostAcknowledgedRowRetainedForRecovery: true,
        wholesaleReupload: false,
        uploadOperations: uploads.length,
      };
      await Bun.write(
        "docs/evidence/issue-61-native-rehearsal.json",
        `${JSON.stringify(result, null, 2)}\n`
      );
      process.stdout.write(`${JSON.stringify(result)}\n`);
      // Explicit discard is only cleanup of this disposable native test account.
      const finalStatus = await native.library("status", desktopStatusSchema);
      await native.library("auth_sign_out", z.json(), {
        request: {
          instanceId: finalStatus.instanceId,
          accountId: finalStatus.accountId,
          generation: finalStatus.generation,
          choice: "discard",
          discardConfirmed: true,
        },
      });
    },
  });
