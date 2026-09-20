import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  organizationReviewSchema,
  organizationStatesSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { promptClient } from "./prompt-fixture";

test("merge receipts, deleted targets and original affected membership survive process restart", async () => {
  const fixture = z
    .object({
      Cookie: z.string(),
      merge: mutationEnvelopeSchema,
      receipt: mutationResponseSchema,
      prompt: promptSchema,
      states: organizationStatesSchema,
      review: organizationReviewSchema,
    })
    .parse(JSON.parse(process.env.PR0_ORGANIZATION_RESTART_FIXTURE ?? "null"));
  const client = promptClient(fixture.Cookie);
  expect(await client.mutatePrompts(fixture.merge)).toEqual(fixture.receipt);
  expect(await client.getPrompt(fixture.prompt.id)).toEqual(fixture.prompt);
  expect(
    await client.getOrganizationStates(
      fixture.states.states.map((state) => state.id)
    )
  ).toEqual(fixture.states);
  expect(
    await client.getOrganizationReview(fixture.review.operationId)
  ).toEqual(fixture.review);
});
