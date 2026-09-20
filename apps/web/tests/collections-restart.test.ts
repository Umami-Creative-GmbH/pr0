import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  organizationSnapshotSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { promptClient } from "./prompt-fixture";

test("collections, assignments, names, counts and original receipts survive a server restart", async () => {
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
    .parse(JSON.parse(process.env.PR0_COLLECTION_RESTART_FIXTURE ?? "null"));
  const client = promptClient(fixture.Cookie);
  expect(await client.mutatePrompts(fixture.envelope)).toEqual(fixture.receipt);
  expect(await client.mutatePrompts(fixture.assignments)).toEqual(
    fixture.assignmentReceipt
  );
  expect(await client.getPrompt(fixture.prompt.id)).toEqual(fixture.prompt);
  expect(await client.getOrganization()).toEqual(fixture.snapshot);
});
