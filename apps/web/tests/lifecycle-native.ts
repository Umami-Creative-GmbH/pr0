// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Native delivery and process restart are a sequential acceptance journey.
import assert from "node:assert/strict";

import {
  lifecycleResultSchema,
  localPromptSchema,
  uploadStatusSchema,
} from "@pr0/api-contract/local-prompts";
import type { LifecycleAction } from "@pr0/api-contract/local-prompts";
import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import type { MutationEnvelope } from "@pr0/api-contract/prompts";
import type { Page } from "playwright";
import { z } from "zod";

import type { NativeArgs } from "./local-native-worker";
import { promptDeletion, promptEdit } from "./prompt-fixture";

export const verifyNativeLifecycle = async ({
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
  const identity = async () =>
    z
      .object({
        instanceId: z.string(),
        accountId: z.string(),
        generation: z.number(),
      })
      .parse(await command("status"));
  const download = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        z
          .object({ complete: z.boolean() })
          .parse(await command("library_download")).complete
      ) {
        return;
      }
    }
    throw new Error("Lifecycle download did not finish");
  };
  const flush = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = uploadStatusSchema.parse(await command("library_upload"));
      assert.equal(status.error, null);
      assert.deepEqual(status.errors, []);
      if (status.waiting === 0) {
        await download();
        return;
      }
    }
    throw new Error("Lifecycle upload did not finish");
  };
  const editor = async (id: string) =>
    localPromptSchema.parse(await command("library_editor", { id }));
  const create = async (title: string, sync = true) => {
    const request = {
      ...(await identity()),
      operationId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
      expectedLocalRevision: null,
      desired: { title, description: "", content: "  Selected snapshot\n" },
    };
    await command("library_create", { request });
    if (sync) {
      await flush();
    }
    return editor(request.promptId);
  };
  const action = async (id: string, selected: LifecycleAction) => {
    const current = await editor(id);
    return lifecycleResultSchema.parse(
      await command("library_lifecycle", {
        request: {
          ...(await identity()),
          operationId: crypto.randomUUID(),
          promptId: id,
          expectedLocalRevision: current.localRevision,
          action: selected,
        },
      })
    );
  };
  const web = async (id: string) => {
    const result = await page.request.get(
      `${origin}/api/v1/library/prompts/${id}`
    );
    assert.equal(result.status(), 200);
    return promptSchema.parse(await result.json());
  };
  const missing = async (id: string) => {
    const response = await page.request.get(
      `${origin}/api/v1/library/prompts/${id}`
    );
    assert.equal(response.status(), 404);
  };
  const remote = async (operations: MutationEnvelope["operations"]) => {
    const envelope = mutationEnvelopeSchema.parse(
      JSON.parse(traffic[0]?.body ?? "")
    );
    const response = await page.request.post(
      `${origin}/api/v1/sync/mutations`,
      {
        headers: { Origin: origin },
        data: { ...envelope, installationId: crypto.randomUUID(), operations },
      }
    );
    assert.equal(response.status(), 200, await response.text());
    const {
      results: [result],
    } = mutationResponseSchema.parse(await response.json());
    assert.ok(result?.status === "accepted" && "promptId" in result);
    return result;
  };
  const edit = async (id: string, content: string) => {
    const source = await editor(id);
    await command("library_edit", {
      request: {
        ...(await identity()),
        promptId: id,
        operationId: crypto.randomUUID(),
        expectedLocalRevision: source.localRevision,
        desired: {
          title: source.prompt.title,
          description: source.prompt.description,
          content,
        },
      },
    });
  };
  await download();
  const parent = await create("Offline parent", false);
  const childId = crypto.randomUUID();
  await action(parent.prompt.id, { kind: "duplicate", copyId: childId });
  await edit(parent.prompt.id, "Edited after copying");
  await restart();
  await flush();
  const savedChild = await web(childId);
  const savedParent = await web(parent.prompt.id);
  assert.equal(savedChild.content, parent.prompt.content);
  assert.equal(savedParent.content, "Edited after copying");
  const source = await create("Offline lifecycle");
  await command("library_copy", {
    fault: "clipboard_fixture",
    request: { ...(await identity()), promptId: source.prompt.id },
  });
  await action(source.prompt.id, { kind: "favorite", value: true });
  await action(source.prompt.id, { kind: "archive", value: true });
  const duplicateId = crypto.randomUUID();
  await action(source.prompt.id, { kind: "duplicate", copyId: duplicateId });
  await restart();
  const restartedSource = await editor(source.prompt.id);
  const restartedCopy = await editor(duplicateId);
  assert.equal(restartedSource.prompt.archived, true);
  assert.equal(restartedCopy.prompt.content, "  Selected snapshot\n");
  await flush();
  const archived = await web(source.prompt.id);
  assert.ok(archived.favorite && archived.archived);
  const duplicate = await web(duplicateId);
  assert.equal(duplicate.title, "Offline lifecycle (copy)");
  assert.ok(!duplicate.favorite && !duplicate.archived);
  assert.equal(duplicate.useCount, 0);
  await action(source.prompt.id, { kind: "archive", value: false });
  await flush();
  const restored = await web(source.prompt.id);
  assert.equal(restored.favorite, true);

  // Delete arrives before offline text; lost preservation receipt plus successors.
  const deletedFirst = await create("Delete before text");
  await edit(deletedFirst.prompt.id, "Offline B1");
  await remote([promptDeletion(deletedFirst.prompt)]);
  lose();
  const lost = uploadStatusSchema.parse(await command("library_upload"));
  assert.ok(lost.error);
  await edit(deletedFirst.prompt.id, "Offline B2 successor");
  await action(deletedFirst.prompt.id, { kind: "favorite", value: true });
  await restart();
  await command("library_recover", {
    request: {
      ...(await identity()),
      promptId: deletedFirst.prompt.id,
      action: "retry",
      confirmed: false,
    },
  });
  await flush();
  const mapped = uploadStatusSchema
    .parse(await command("library_upload_status"))
    .mappings.find((entry) => entry.originalId === deletedFirst.prompt.id);
  assert.ok(mapped);
  await missing(deletedFirst.prompt.id);
  const preserved = await web(mapped.copyId);
  assert.equal(preserved.content, "Offline B2 successor");
  assert.equal(preserved.favorite, true);

  // Text arrives before a stale native delete: preserve the unseen server text.
  const textFirst = await create("Text before delete");
  await remote([
    promptEdit(textFirst.prompt, {
      title: textFirst.prompt.title,
      description: "",
      content: "Unseen server text",
    }),
  ]);
  await action(textFirst.prompt.id, { kind: "delete", confirmed: true });
  await restart();
  await flush();
  await missing(textFirst.prompt.id);
  const conflicts = await page.request.get(
    `${origin}/api/v1/library/conflicts`
  );
  const notices = z
    .object({
      notices: z.array(
        z.object({ originalId: z.string(), copyId: z.string() })
      ),
    })
    .parse(await conflicts.json());
  const notice = notices.notices.find(
    (entry) => entry.originalId === textFirst.prompt.id
  );
  assert.ok(notice);
  const unseenCopy = await web(notice.copyId);
  assert.equal(unseenCopy.content, "Unseen server text");

  // Metadata cannot resurrect a deleted prompt. Its refused local intent stays reviewable.
  const metadata = await create("Deleted metadata");
  await action(metadata.prompt.id, { kind: "favorite", value: true });
  await remote([promptDeletion(metadata.prompt)]);
  const rejected = uploadStatusSchema.parse(await command("library_upload"));
  assert.ok(
    rejected.errors.some(
      (entry) =>
        entry.promptId === metadata.prompt.id && entry.code === "not_found"
    )
  );
  await missing(metadata.prompt.id);
  await command("library_changes");
  await command("library_recover", {
    request: {
      ...(await identity()),
      promptId: metadata.prompt.id,
      action: "discard",
      confirmed: true,
    },
  });
  await missing(metadata.prompt.id);

  // Replay an old accepted operation after subsequent server deletion.
  const replayId = crypto.randomUUID();
  await command("library_create", {
    request: {
      ...(await identity()),
      operationId: crypto.randomUUID(),
      promptId: replayId,
      expectedLocalRevision: null,
      desired: {
        title: "Replay after deletion",
        description: "",
        content: "Never resurrect",
      },
    },
  });
  lose();
  assert.ok(uploadStatusSchema.parse(await command("library_upload")).error);
  await remote([promptDeletion(await web(replayId))]);
  await restart();
  await command("library_recover", {
    request: {
      ...(await identity()),
      promptId: replayId,
      action: "retry",
      confirmed: false,
    },
  });
  await flush();
  await missing(replayId);
  await assert.rejects(() => editor(replayId));
  // Usage is independent of lifecycle; finish its pending delivery before sign-out.
  await command("library_sync_usage");
  await command("library_changes");
  const used = await web(source.prompt.id);
  assert.equal(used.useCount, 1);
  process.stdout.write(
    "LIFECYCLE_NATIVE_OK: offline restart, archive/favorite/duplicate, both deletion orders, metadata refusal, replay and preserved successors\n"
  );
};
