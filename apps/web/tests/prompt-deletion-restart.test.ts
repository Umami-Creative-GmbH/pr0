import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptSchema,
  conflictPageSchema,
  promptPageSchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { promptClient } from "./prompt-fixture";

test("restart retains permanent deletion, preserved copy, exact quota, notice and receipt", async () => {
  const fixture = z
    .object({
      Cookie: z.string(),
      envelope: mutationEnvelopeSchema,
      receipt: mutationResponseSchema,
      sourceId: z.uuid(),
      copy: promptSchema,
      notices: conflictPageSchema,
      page: promptPageSchema,
    })
    .parse(JSON.parse(process.env.PR0_DELETE_RESTART_FIXTURE ?? "null"));
  const client = promptClient(fixture.Cookie);
  expect(await client.mutatePrompts(fixture.envelope)).toEqual(fixture.receipt);
  await expect(client.getPrompt(fixture.sourceId)).rejects.toMatchObject({
    status: 404,
  });
  expect(await client.getPrompt(fixture.copy.id)).toEqual(fixture.copy);
  expect(await client.getConflicts()).toEqual(fixture.notices);
  expect(await client.getPrompts()).toEqual(fixture.page);
});
