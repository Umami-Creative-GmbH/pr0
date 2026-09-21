// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- The native command stream controls durable synchronization boundaries.
import assert from "node:assert/strict";

import { createPromptClient } from "@pr0/api-client/prompts";
import { librarySchema } from "@pr0/api-contract/accounts";
import {
  localAdjustmentPageSchema,
  localConflictPageSchema,
  uploadStatusSchema,
} from "@pr0/api-contract/local-prompts";
import { downloadStatusSchema } from "@pr0/api-contract/snapshots";
import { z } from "zod";

import { accountTestServer, runAcceptance } from "./account-test-server";
import { collectionOperation } from "./collection-fixture";
import { verifyNativeHttps } from "./device-native";
import { promptEdit, promptOperation } from "./prompt-fixture";

const server = accountTestServer(
  "pr0-attention-46",
  "apps/web/tests/changes-compose.yaml",
  () =>
    runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/deletions.ts",
      "initialize",
    ])
);
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/conflict-review-integration.test.ts",
    "apps/web/tests/conflict-review-browser.test.ts",
    "--timeout",
    "60000",
  ]);
  await verifyNativeHttps(server, {
    afterSession: async ({ native, page, origin }) => {
      const libraryResponse = await page.request.get(
        `${origin}/api/v1/library`
      );
      const library = librarySchema.parse(await libraryResponse.json());
      const identity = {
        protocolVersion: 1 as const,
        instanceId: library.instance.id,
        accountId: library.account.id,
        epoch: library.epoch,
        installationId: crypto.randomUUID(),
      };
      const client = createPromptClient(origin, async (url, init) => {
        const response = await page.request.fetch(url, {
          method: init.method,
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            Origin: origin,
          },
          data: z.string().optional().parse(init.body),
        });
        return new Response(await response.text(), {
          status: response.status(),
          headers: response.headers(),
        });
      });
      const create = promptOperation({
        title: "🌍".repeat(200),
        description: "",
        content: "baseline",
      });
      await client.mutatePrompts({ ...identity, operations: [create] });
      const base = await client.getPrompt(create.promptId);
      await client.mutatePrompts({
        ...identity,
        operations: [promptEdit(base, { ...create.desired, content: "first" })],
      });
      await client.mutatePrompts({
        ...identity,
        operations: [
          promptEdit(base, { ...create.desired, content: "second" }),
        ],
      });
      let download = await native.library(
        "library_download",
        downloadStatusSchema
      );
      while (!download.complete) {
        download = await native.library(
          "library_download",
          downloadStatusSchema
        );
      }
      await native.library("library_refresh_conflicts", z.null());
      const conflicts = await native.library(
        "library_conflicts",
        localConflictPageSchema
      );
      assert.equal(conflicts.notices.length, 1);
      assert.equal(conflicts.notices[0]?.sourceTitle, create.desired.title);
      assert.equal(conflicts.notices[0]?.copyAvailable, true);
      const scope = z
        .object({
          instanceId: z.string(),
          accountId: z.string(),
          generation: z.number(),
        })
        .parse(await native.library("status", z.json()));
      await native.library("library_review_conflict", z.null(), {
        request: { ...scope, noticeId: conflicts.notices[0]?.id ?? "" },
      });
      const conflictUpload = await native.library(
        "library_upload",
        uploadStatusSchema
      );
      assert.equal(conflictUpload.waiting, 0);
      const reviewedConflicts = await client.getConflicts();
      assert.deepEqual(reviewedConflicts.notices, []);
      const collection = collectionOperation("Removed remotely");
      await client.mutatePrompts({ ...identity, operations: [collection] });
      const state = await client.getOrganization();
      await client.mutatePrompts({
        ...identity,
        operations: [
          {
            kind: "collection.delete",
            operationId: crypto.randomUUID(),
            collectionId: collection.collectionId,
            baseRevision: state.revision,
            dependsOn: [],
          },
        ],
      });
      const adjusted = promptOperation();
      await client.mutatePrompts({
        ...identity,
        operations: [
          {
            ...adjusted,
            desired: {
              ...adjusted.desired,
              collectionId: collection.collectionId,
            },
          },
        ],
      });
      await native.library("library_refresh_adjustments", z.null());
      const adjustments = await native.library(
        "library_adjustments",
        localAdjustmentPageSchema
      );
      assert.equal(adjustments.notices.length, 1);
      await native.library("library_review_adjustment", z.null(), {
        request: { ...scope, noticeId: adjustments.notices[0]?.id ?? "" },
      });
      const adjustmentUpload = await native.library(
        "library_upload",
        uploadStatusSchema
      );
      assert.equal(adjustmentUpload.waiting, 0);
      const reviewedAdjustments = await client.getAdjustments();
      assert.deepEqual(reviewedAdjustments.notices, []);
      await native.library("library_changes", z.json());
      process.stdout.write(
        "PASS native HTTPS conflict/adjustment download, exact source title, durable review upload and canonical acknowledgement\n"
      );
    },
  });
} finally {
  await server.cleanup();
}
