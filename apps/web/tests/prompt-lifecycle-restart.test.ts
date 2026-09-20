import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { promptClient } from "./prompt-fixture";

test("restart retains archive, favorite, full duplicate source title and the once-only receipt", async () => {
  const fixture = z
    .object({
      Cookie: z.string(),
      envelope: mutationEnvelopeSchema,
      receipt: mutationResponseSchema,
      source: promptSchema,
      copy: promptSchema,
    })
    .parse(JSON.parse(process.env.PR0_LIFECYCLE_RESTART_FIXTURE ?? "null"));
  const client = promptClient(fixture.Cookie);
  expect(await client.getPrompt(fixture.source.id)).toEqual(fixture.source);
  expect(await client.getPrompt(fixture.copy.id)).toEqual(fixture.copy);
  expect(await client.mutatePrompts(fixture.envelope)).toEqual(fixture.receipt);
  expect(await client.getPrompts({ view: "archive" })).toMatchObject({
    prompts: [{ id: fixture.source.id, archived: true, favorite: true }],
    usage: { promptCount: 2 },
  });
  expect(await client.getPrompts({ view: "favorites" })).toMatchObject({
    prompts: [],
  });
});
