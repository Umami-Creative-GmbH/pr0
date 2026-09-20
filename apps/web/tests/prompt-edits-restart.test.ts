import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptSchema,
  conflictPageSchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { promptClient } from "./prompt-fixture";

test("restart retains the independent copy, notice, full source title and original receipt", async () => {
  const fixture = z
    .object({
      Cookie: z.string(),
      envelope: mutationEnvelopeSchema,
      receipt: mutationResponseSchema,
      copy: promptSchema,
      notices: conflictPageSchema,
    })
    .parse(JSON.parse(process.env.PR0_EDIT_RESTART_FIXTURE ?? "null"));
  const client = promptClient(fixture.Cookie);
  expect(await client.getPrompt(fixture.copy.id)).toEqual(fixture.copy);
  expect(await client.getConflicts()).toEqual(fixture.notices);
  expect(await client.mutatePrompts(fixture.envelope)).toEqual(fixture.receipt);
  expect(await client.getPrompts()).toMatchObject({
    usage: { promptCount: 2 },
  });
});
