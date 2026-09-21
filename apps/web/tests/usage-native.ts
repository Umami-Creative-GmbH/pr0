// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Durable native acknowledgements and REST transitions are ordered.
import assert from "node:assert/strict";

import {
  desktopCopyResultSchema,
  desktopUsageStatusSchema,
} from "@pr0/api-contract/desktop-copy";
import { localPromptSchema } from "@pr0/api-contract/local-prompts";
import { promptUseFixtures } from "@pr0/api-contract/prompt-use-fixtures";
import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptSchema,
  promptPageSchema,
} from "@pr0/api-contract/prompts";
import type { Page } from "playwright";
import { z } from "zod";

import type { NativeArgs } from "./local-native-worker";
import { promptState, promptDeletion } from "./prompt-fixture";

export const verifyNativeUsage = async ({
  command,
  restart,
  lose,
  traffic,
  page,
  origin,
}: {
  command: (
    name: string,
    args?: NativeArgs
  ) => Promise<z.infer<ReturnType<typeof z.json>>>;
  restart: () => Promise<void>;
  lose: () => void;
  traffic: { path: string; body: string }[];
  page: Page;
  origin: string;
}) => {
  const download = async () => {
    let complete = false;
    while (!complete) {
      ({ complete } = z
        .object({ complete: z.boolean() })
        .parse(await command("library_download")));
    }
  };
  await download();
  let identity = z
    .object({
      instanceId: z.string(),
      accountId: z.string(),
      generation: z.number(),
    })
    .parse(await command("status"));
  const request = {
    ...identity,
    operationId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
    expectedLocalRevision: null,
    desired: {
      title: "Offline copy",
      description: "",
      content: promptUseFixtures.text,
    },
  };
  let saved = localPromptSchema.parse(
    await command("library_create", { request })
  );
  await command("library_upload");
  await download();
  saved = localPromptSchema.parse(
    await command("library_editor", { id: saved.prompt.id })
  );
  const modified = saved.prompt.modifiedAt;
  const input = { ...identity, promptId: saved.prompt.id };
  const copy = desktopCopyResultSchema.parse(
    await command("library_copy", {
      request: input,
      occurredAt: promptUseFixtures.future,
    })
  );
  assert.equal(copy.usageSaved, true);
  assert.equal(await command("test_clipboard_text"), promptUseFixtures.text);
  assert.equal(
    promptSchema.parse(await command("library_detail", { id: input.promptId }))
      .modifiedAt,
    modified
  );
  const start = traffic.length;
  lose();
  const failed = desktopUsageStatusSchema.parse(
    await command("library_sync_usage")
  );
  assert.ok(failed.error);
  await restart();
  identity = z
    .object({
      instanceId: z.string(),
      accountId: z.string(),
      generation: z.number(),
    })
    .parse(await command("status"));
  await Bun.sleep(failed.retryAfterMs + 25);
  assert.equal(
    desktopUsageStatusSchema.parse(await command("library_sync_usage")).waiting,
    0
  );
  assert.equal(traffic[start + 1]?.path, "/api/v1/sync/receipts");
  assert.deepEqual(
    JSON.parse(traffic[start]?.body ?? ""),
    JSON.parse(traffic[start + 1]?.body ?? "")
  );
  await download();
  const fetchPrompt = async () => {
    const response = await page.request.get(
      `${origin}/api/v1/library/prompts/${input.promptId}`
    );
    return promptSchema.parse(await response.json());
  };
  let web = await fetchPrompt();
  let local = promptSchema.parse(
    await command("library_detail", { id: input.promptId })
  );
  assert.equal(local.lastUsedAt, web.lastUsedAt);
  assert.equal(local.useCount, 1);
  assert.equal(local.modifiedAt, modified);
  assert.notEqual(local.lastUsedAt, promptUseFixtures.future);
  await command("library_copy", {
    request: { ...identity, promptId: input.promptId },
    occurredAt: promptUseFixtures.old,
  });
  await command("library_sync_usage");
  await download();
  local = promptSchema.parse(
    await command("library_detail", { id: input.promptId })
  );
  assert.equal(local.lastUsedAt, web.lastUsedAt);
  assert.equal(local.useCount, 2);
  const envelope = mutationEnvelopeSchema.parse(
    JSON.parse(traffic[start]?.body ?? "")
  );
  const mutate = async (
    operations: z.infer<typeof mutationEnvelopeSchema>["operations"]
  ) => {
    const response = await page.request.post(
      `${origin}/api/v1/sync/mutations`,
      { headers: { Origin: origin }, data: { ...envelope, operations } }
    );
    assert.equal(response.status(), 200, await response.text());
    assert.equal(
      mutationResponseSchema.parse(await response.json()).results[0]?.status,
      "accepted"
    );
  };
  web = await fetchPrompt();
  await mutate([promptState(web, "archived", true)]);
  // A further local use forces a current replacement snapshot, including the remote archive.
  await command("library_copy", {
    request: { ...identity, promptId: input.promptId },
  });
  await command("library_sync_usage");
  await download();
  assert.deepEqual(await command("library_recents"), []);
  await command("library_copy", {
    request: { ...identity, promptId: input.promptId },
  });
  await command("library_sync_usage");
  await download();
  assert.deepEqual(await command("library_recents"), []);
  web = await fetchPrompt();
  assert.equal(web.useCount, 4);
  await mutate([promptState(web, "archived", false)]);
  await command("library_copy", {
    request: { ...identity, promptId: input.promptId },
  });
  await command("library_sync_usage");
  await download();
  assert.equal(
    z
      .array(z.object({ id: z.string() }))
      .parse(await command("library_recents"))[0]?.id,
    input.promptId
  );
  const response = await page.request.get(
    `${origin}/api/v1/library/prompts?view=recents`
  );
  assert.equal(
    promptPageSchema.parse(await response.json()).prompts[0]?.id,
    input.promptId
  );
  web = await fetchPrompt();
  await mutate([promptDeletion(web)]);
  await command("library_copy", {
    request: { ...identity, promptId: input.promptId },
  });
  await command("library_sync_usage");
  await download();
  assert.deepEqual(await command("library_recents"), []);
  await assert.rejects(
    command("library_copy", {
      request: { ...identity, promptId: input.promptId },
    }),
    /prompt_unavailable/u
  );
  const missing = await page.request.get(
    `${origin}/api/v1/library/prompts/${input.promptId}`
  );
  assert.equal(missing.status(), 404);
  assert.equal(
    desktopUsageStatusSchema.parse(await command("library_usage_status"))
      .awaitingDownload,
    0
  );
  process.stdout.write(
    "PASS native OS clipboard, restart and receipt replay, future correction, delayed use, web Recents, archive/restore and permanent deletion\n"
  );
};
