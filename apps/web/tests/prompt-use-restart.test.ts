import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { promptClient } from "./prompt-fixture";

test("restart preserves capped usage, Recents and the original replay receipt", async () => {
  const fixture = z
    .object({
      Cookie: z.string(),
      envelope: mutationEnvelopeSchema,
      receipt: mutationResponseSchema,
      prompt: promptSchema,
    })
    .parse(JSON.parse(process.env.PR0_USE_RESTART_FIXTURE ?? "null"));
  const client = promptClient(fixture.Cookie);
  expect(await client.mutatePrompts(fixture.envelope)).toEqual(fixture.receipt);
  expect(await client.getPrompt(fixture.prompt.id)).toEqual(fixture.prompt);
  const recents = await client.getPrompts({ view: "recents" });
  expect(recents.prompts.map((row) => row.id)).toEqual([fixture.prompt.id]);
});
