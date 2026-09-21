// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- The journey advances durable native commands in protocol order.
import assert from "node:assert/strict";

import { changeStatusSchema } from "@pr0/api-contract/changes";
import {
  localPromptSchema,
  uploadStatusSchema,
} from "@pr0/api-contract/local-prompts";
import {
  mutationResponseSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import {
  downloadStatusSchema,
  recoverySummariesSchema,
} from "@pr0/api-contract/snapshots";
import { SQL } from "bun";
import type { Page } from "playwright";
import { z } from "zod";

import type { NativeArgs } from "./local-native-worker";
import { promptOperation, promptEdit } from "./prompt-fixture";

export const verifyNativeRecovery = async ({
  command,
  page,
  origin,
}: {
  command: (
    name: string,
    args?: NativeArgs
  ) => Promise<z.infer<ReturnType<typeof z.json>>>;
  page: Page;
  origin: string;
}) => {
  const libraryResponse = await page.request.get(`${origin}/api/v1/library`);
  const identity = z
    .object({
      instance: z.object({ id: z.string() }),
      account: z.object({ id: z.string() }),
      epoch: z.string(),
    })
    .parse(await libraryResponse.json());
  const operation = promptOperation({
    title: "Before long absence",
    description: "",
    content: "Original saved text",
  });
  const mutate = async (operations: NativeArgs[string][]) => {
    const response = await page.request.post(
      `${origin}/api/v1/sync/mutations`,
      {
        headers: { Origin: origin },
        data: {
          protocolVersion: 1,
          instanceId: identity.instance.id,
          accountId: identity.account.id,
          epoch: identity.epoch,
          installationId: crypto.randomUUID(),
          operations,
        },
      }
    );
    const result = mutationResponseSchema.parse(await response.json());
    assert.equal(result.results[0]?.status, "accepted");
  };
  await mutate([operation]);
  const download = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = downloadStatusSchema.parse(
        await command("library_download")
      );
      if (status.complete) {
        return status;
      }
    }
    throw new Error("Recovery failed to finish within twenty bounded commands");
  };
  await download();
  const original = localPromptSchema.parse(
    await command("library_editor", { id: operation.promptId })
  );
  const native = z
    .object({
      instanceId: z.string(),
      accountId: z.string(),
      generation: z.number(),
    })
    .parse(await command("status"));
  const pendingId = crypto.randomUUID();
  await command("library_edit", {
    request: {
      ...native,
      operationId: pendingId,
      promptId: operation.promptId,
      expectedLocalRevision: original.localRevision,
      desired: {
        title: original.prompt.title,
        description: "",
        content: "Offline edit after months",
      },
    },
  });
  await mutate([
    promptEdit(original.prompt, {
      title: original.prompt.title,
      description: "",
      content: "Other device's competing text",
    }),
  ]);
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  try {
    // Fixture only the external retention/restore boundaries; observations use REST/native commands.
    await sql`UPDATE library_change SET accepted_at=clock_timestamp()-interval '91 days' WHERE account_id=${identity.account.id}`;
    assert.equal(
      changeStatusSchema.parse(await command("library_changes")).error,
      "snapshot_required"
    );
    const staged = downloadStatusSchema.parse(
      await command("library_download")
    );
    assert.equal(staged.replacement, true);
    assert.equal(staged.catchingUp, true);
    assert.equal(
      localPromptSchema.parse(
        await command("library_editor", { id: operation.promptId })
      ).prompt.content,
      "Offline edit after months"
    );
    const intervening = promptOperation({
      title: "During staging",
      description: "",
      content: "Arrived after snapshot cut",
    });
    await mutate([intervening]);
    await download();
    assert.equal(
      promptSchema.parse(
        await command("library_detail", { id: intervening.promptId })
      ).content,
      "Arrived after snapshot cut"
    );
    const accepted = uploadStatusSchema.parse(await command("library_upload"));
    assert.equal(accepted.awaitingDownload, 1);
    assert.ok(
      accepted.mappings.some((entry) => entry.originalId === operation.promptId)
    );
    // Restore establishes a new epoch while this accepted variant is still awaiting download.
    const lostCopy = accepted.mappings[0]?.copyId;
    assert.ok(lostCopy);
    await sql.begin(async (tx) => {
      await tx`DELETE FROM prompt WHERE account_id=${identity.account.id} AND id=${lostCopy}`;
      await tx`DELETE FROM library_operation WHERE account_id=${identity.account.id} AND operation_id=${pendingId}`;
      await tx`DELETE FROM conflict_notice WHERE account_id=${identity.account.id} AND copy_id=${lostCopy}`;
      await tx`UPDATE library SET revision=revision-1,prompt_count=prompt_count-1,text_bytes=(SELECT coalesce(sum(octet_length(title)+octet_length(description)+octet_length(content)+coalesce(octet_length(source_title),0)),0) FROM prompt WHERE account_id=${identity.account.id}) WHERE account_id=${identity.account.id}`;
    });
    await sql`UPDATE instance SET recovery_epoch=${crypto.randomUUID()} WHERE id=${identity.instance.id}`;
    assert.equal(
      changeStatusSchema.parse(await command("library_changes")).error,
      "snapshot_required"
    );
    await download();
    const preserved = uploadStatusSchema.parse(
      await command("library_upload_status")
    );
    assert.equal(preserved.awaitingDownload, 1);
    assert.ok(
      preserved.errors.some((entry) => entry.code === "recovery_required")
    );
    const archive = recoverySummariesSchema.parse(
      await command("library_recovery_browse", { offset: 0 })
    );
    const copy = archive.find(
      (entry) => entry.promptId === accepted.mappings[0]?.copyId
    );
    assert.ok(copy);
    assert.equal(
      promptSchema.parse(
        await command("library_recovery_detail", {
          snapshotId: copy.snapshotId,
          id: copy.promptId,
        })
      ).content,
      "Offline edit after months"
    );
    process.stdout.write(
      `RECOVERY_NATIVE ${JSON.stringify({ expiredHistoryDays: 91, retainedPrompts: archive.length, acceptedAwaitingDownload: preserved.awaitingDownload, pendingId, interveningChanges: true })}\n`
    );
    await command("auth_sign_out", {
      request: { ...native, choice: "discard", discardConfirmed: true },
    });
  } finally {
    await sql.close();
  }
};
