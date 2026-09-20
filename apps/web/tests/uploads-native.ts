// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Retries and native process restart deliberately follow durable acknowledgements.
import assert from "node:assert/strict";

import {
  localPromptSchema,
  uploadStatusSchema,
} from "@pr0/api-contract/local-prompts";
import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import type { Page } from "playwright";
import { z } from "zod";

import type { NativeArgs } from "./local-native-worker";
import { promptEdit } from "./prompt-fixture";

export const verifyNativeUploads = async ({
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
  const identity = z
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
      title: "Offline upload",
      description: "",
      content: "B1 exact\n",
    },
  };
  let saved = localPromptSchema.parse(
    await command("library_create", { request })
  );
  lose();
  const lost = uploadStatusSchema.parse(await command("library_upload"));
  assert.ok(lost.error);
  saved = localPromptSchema.parse(
    await command("library_edit", {
      request: {
        ...request,
        operationId: crypto.randomUUID(),
        expectedLocalRevision: saved.localRevision,
        desired: { ...request.desired, content: "B2 exact\n" },
      },
    })
  );
  await restart();
  await Bun.sleep(lost.retryAfterMs + 50);
  const accepted = uploadStatusSchema.parse(await command("library_upload"));
  assert.equal(accepted.error, null);
  assert.equal(accepted.waiting, 1);
  assert.equal(traffic[1]?.path, "/api/v1/sync/receipts");
  assert.deepEqual(
    JSON.parse(traffic[0]?.body ?? ""),
    JSON.parse(traffic[1]?.body ?? "")
  );
  assert.equal(
    localPromptSchema.parse(
      await command("library_editor", { id: saved.prompt.id })
    ).prompt.content,
    "B2 exact\n"
  );
  assert.equal(
    uploadStatusSchema.parse(await command("library_upload")).waiting,
    0
  );
  await download();
  saved = localPromptSchema.parse(
    await command("library_editor", { id: saved.prompt.id })
  );
  assert.equal(saved.pending, false);
  assert.equal(saved.prompt.content, "B2 exact\n");
  const web = await page.request.get(
    `${origin}/api/v1/library/prompts/${saved.prompt.id}`
  );
  assert.equal(promptSchema.parse(await web.json()).content, "B2 exact\n");
  const envelope = mutationEnvelopeSchema.parse(
    JSON.parse(traffic[0]?.body ?? "")
  );
  const remote = await page.request.post(`${origin}/api/v1/sync/mutations`, {
    headers: { Origin: origin },
    data: {
      ...envelope,
      installationId: crypto.randomUUID(),
      operations: [
        promptEdit(saved.prompt, {
          title: saved.prompt.title,
          description: saved.prompt.description,
          content: "A competing text",
        }),
      ],
    },
  });
  assert.equal(remote.status(), 200, await remote.text());
  assert.equal(
    mutationResponseSchema.parse(await remote.json()).results[0]?.status,
    "accepted"
  );
  const edit = {
    ...request,
    generation: z
      .object({ generation: z.number() })
      .parse(await command("status")).generation,
    promptId: saved.prompt.id,
    operationId: crypto.randomUUID(),
    expectedLocalRevision: saved.localRevision,
    desired: { ...request.desired, content: "B3 competing text" },
  };
  saved = localPromptSchema.parse(
    await command("library_edit", { request: edit })
  );
  lose();
  const lostEdit = uploadStatusSchema.parse(await command("library_upload"));
  assert.ok(lostEdit.error);
  await command("library_edit", {
    request: {
      ...edit,
      operationId: crypto.randomUUID(),
      expectedLocalRevision: saved.localRevision,
      desired: { ...edit.desired, content: "B4 retained successor" },
    },
  });
  await restart();
  await Bun.sleep(lostEdit.retryAfterMs + 50);
  const mapped = uploadStatusSchema.parse(await command("library_upload"));
  assert.equal(mapped.error, null);
  assert.equal(mapped.waiting, 1);
  const [copy] = mapped.mappings;
  assert.ok(copy);
  assert.equal(
    localPromptSchema.parse(
      await command("library_editor", { id: copy.copyId })
    ).prompt.content,
    "B4 retained successor"
  );
  assert.equal(
    uploadStatusSchema.parse(await command("library_upload")).waiting,
    0
  );
  await download();
  for (const [id, text] of [
    [copy.originalId, "A competing text"],
    [copy.copyId, "B4 retained successor"],
  ]) {
    const response = await page.request.get(
      `${origin}/api/v1/library/prompts/${id}`
    );
    assert.equal(promptSchema.parse(await response.json()).content, text);
  }
  assert.equal(
    uploadStatusSchema.parse(await command("library_upload_status"))
      .awaitingDownload,
    0
  );
  process.stdout.write(
    "PASS native SQLite → lost create/edit HTTPS responses → process restart → receipt lookup → conflict successor → canonical download → web text\n"
  );
};
