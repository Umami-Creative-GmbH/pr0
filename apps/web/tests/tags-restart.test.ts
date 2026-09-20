import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  organizationSnapshotSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { promptClient } from "./prompt-fixture";
import { tagDelta } from "./tag-fixture";

test("tag identities, unused entries, removal baselines and receipts survive a server restart", async () => {
  const fixture = z
    .object({
      Cookie: z.string(),
      envelope: mutationEnvelopeSchema,
      receipt: mutationResponseSchema,
      assignments: mutationEnvelopeSchema,
      assignmentReceipt: mutationResponseSchema,
      prompt: promptSchema,
      snapshot: organizationSnapshotSchema,
    })
    .parse(JSON.parse(process.env.PR0_TAG_RESTART_FIXTURE ?? "null"));
  const client = promptClient(fixture.Cookie);
  expect(await client.mutatePrompts(fixture.envelope)).toEqual(fixture.receipt);
  expect(await client.mutatePrompts(fixture.assignments)).toEqual(
    fixture.assignmentReceipt
  );
  expect(await client.getPrompt(fixture.prompt.id)).toEqual(fixture.prompt);
  expect(await client.getOrganization()).toEqual(fixture.snapshot);
  const [tag] = fixture.snapshot.tags;
  if (!tag) {
    throw new Error("Expected retained tag");
  }
  await client.mutatePrompts({
    ...fixture.envelope,
    operations: [tagDelta(fixture.prompt.id, "0", [tag.id])],
  });
  expect(await client.getPrompt(fixture.prompt.id)).toMatchObject({
    tagIds: [],
  });
  await client.mutatePrompts({
    ...fixture.envelope,
    operations: [
      tagDelta(fixture.prompt.id, fixture.snapshot.revision, [tag.id]),
    ],
  });
  expect(await client.getPrompt(fixture.prompt.id)).toMatchObject({
    tagIds: [tag.id],
  });
});
