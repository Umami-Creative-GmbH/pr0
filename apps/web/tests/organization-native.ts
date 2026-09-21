// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Two native command streams deliberately control causal ordering.
import assert from "node:assert/strict";

import { localOrganizationSchema } from "@pr0/api-contract/local-organization";
import type { OrganizationAction } from "@pr0/api-contract/local-organization";
import {
  localPromptSchema,
  uploadStatusSchema,
} from "@pr0/api-contract/local-prompts";
import { z } from "zod";

import type { NativeArgs } from "./local-native-worker";

type Command = (
  name: string,
  args?: NativeArgs
) => Promise<z.infer<ReturnType<typeof z.json>>>;
const snapshot = async (command: Command) =>
  localOrganizationSchema.parse(await command("library_organization"));
const save = async (
  command: Command,
  action: OrganizationAction,
  replaces?: string
) => {
  const identity = z
    .object({
      instanceId: z.string(),
      accountId: z.string(),
      generation: z.number(),
    })
    .parse(await command("status"));
  const current = await snapshot(command);
  const request = {
    ...identity,
    action,
    operationId: crypto.randomUUID(),
    expectedLocalRevision: current.localRevision,
    replaces: replaces ?? null,
  };
  await command("library_organize", {
    request,
  });
  return request.operationId;
};
const upload = async (command: Command) => {
  for (let count = 0; count < 30; count += 1) {
    const progress = uploadStatusSchema.parse(await command("library_upload"));
    assert.equal(progress.error, null);
    if (!progress.waiting) {
      return;
    }
    const current = await snapshot(command);
    assert.equal(
      current.pending.some((entry) => entry.error),
      false,
      JSON.stringify(current.pending)
    );
  }
  throw new Error("Organization queue did not drain");
};
const refresh = async (command: Command) => {
  await command("library_changes");
  await command("library_reconcile");
};
export const verifyNativeOrganization = async ({
  commands,
}: {
  commands: Command[];
}) => {
  const [first, second] = commands;
  if (!first || !second) {
    throw new Error("Two native devices are required");
  }
  await first("library_download");
  await second("library_download");
  const source = crypto.randomUUID();
  const canonical = crypto.randomUUID();
  await save(first, { kind: "tag.create", id: source, name: "Straße" });
  await save(second, { kind: "tag.create", id: canonical, name: "STRASSE" });
  await upload(second);
  const identity = z
    .object({
      instanceId: z.string(),
      accountId: z.string(),
      generation: z.number(),
    })
    .parse(await first("status"));
  const { prompt } = localPromptSchema.parse(
    await first("library_create", {
      request: {
        ...identity,
        operationId: crypto.randomUUID(),
        promptId: crypto.randomUUID(),
        expectedLocalRevision: null,
        desired: {
          title: "Offline organized prompt",
          description: "",
          content: "Exact retained body\n",
        },
      },
    })
  );
  await save(first, {
    kind: "prompt.tags",
    id: prompt.id,
    add: [source],
    remove: [],
  });
  await upload(first);
  await refresh(first);
  await refresh(second);
  let current = localPromptSchema.parse(
    await first("library_editor", { id: prompt.id })
  );
  assert.deepEqual(current.prompt.tagIds, [canonical]);
  const observed1 = await snapshot(first);
  assert.equal(
    observed1.tags.filter((tag) => tag.name.toUpperCase() === "STRASSE").length,
    1
  );

  // An unseen remove on device two beats device one's older add, including a no-op removal.
  await save(first, {
    kind: "prompt.tags",
    id: prompt.id,
    add: [canonical],
    remove: [],
  });
  await save(second, {
    kind: "prompt.tags",
    id: prompt.id,
    add: [],
    remove: [canonical],
  });
  await upload(second);
  await refresh(first);
  assert.deepEqual(
    localPromptSchema.parse(await first("library_editor", { id: prompt.id }))
      .prompt.tagIds,
    []
  );
  await upload(first);
  await refresh(first);
  await refresh(second);
  await save(first, {
    kind: "prompt.tags",
    id: prompt.id,
    add: [canonical],
    remove: [],
  });
  await upload(first);
  await refresh(first);
  await refresh(second);
  assert.deepEqual(
    localPromptSchema.parse(await first("library_editor", { id: prompt.id }))
      .prompt.tagIds,
    [canonical]
  );

  const destination = crypto.randomUUID();
  const final = crypto.randomUUID();
  await save(second, {
    kind: "tag.create",
    id: destination,
    name: "Destination",
  });
  await save(second, { kind: "tag.create", id: final, name: "Final" });
  await upload(second);
  await refresh(second);
  await save(first, { kind: "tag.rename", id: canonical, name: "Destination" });
  const rejected = uploadStatusSchema.parse(await first("library_upload"));
  assert.equal(rejected.waiting, 1);
  const observed2 = await snapshot(first);
  let queued = observed2.pending.find((entry) => entry.error);
  assert.equal(queued?.error, "name_conflict");
  await refresh(first);
  const observed3 = await snapshot(first);
  assert.equal(
    observed3.tags.length,
    3,
    "A rejected rename must not merge identities"
  );
  await save(
    first,
    { kind: "tag.merge", id: canonical, targetId: destination },
    queued?.id
  );
  await upload(first);
  await refresh(first);
  await refresh(second);
  await save(second, { kind: "tag.merge", id: destination, targetId: final });
  await upload(second);
  await refresh(first);
  await refresh(second);
  const observed4 = await snapshot(first);
  assert.equal(
    observed4.states.find((state) => state.id === canonical)?.targetId,
    final
  );
  const filtered = z.array(z.json()).parse(
    await first("library_organization_browse", {
      request: {
        collectionId: null,
        tagIds: [canonical],
        offset: 0,
        recents: false,
      },
    })
  );
  assert.equal(filtered.length, 0);
  await save(second, { kind: "tag.delete", id: final });
  await upload(second);
  await refresh(first);
  await refresh(second);
  current = localPromptSchema.parse(
    await first("library_editor", { id: prompt.id })
  );
  assert.deepEqual(current.prompt.tagIds, []);
  assert.equal(current.prompt.content, "Exact retained body\n");

  const collection = crypto.randomUUID();
  await save(first, {
    kind: "collection.create",
    id: collection,
    name: "Work",
  });
  await save(second, {
    kind: "collection.create",
    id: crypto.randomUUID(),
    name: "work",
  });
  await upload(second);
  await first("library_upload");
  const observed5 = await snapshot(first);
  queued = observed5.pending.find((entry) => entry.error);
  assert.equal(queued?.error, "name_conflict");
  await save(
    first,
    { kind: "collection.create", id: collection, name: "Personal work" },
    queued?.id
  );
  await upload(first);
  await refresh(first);
  await refresh(second);
  const observed6 = await snapshot(first);
  assert.equal(
    observed6.collections.some((entry) => entry.name === "Personal work"),
    true
  );
  process.stdout.write(
    "PASS two native devices: identity mapping, causal removal/re-add, explicit collision merge, alias chain, target deletion, retained collection correction\n"
  );
};
