import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { origin } from "./http-fixture";
import { promptClient } from "./prompt-fixture";

const fixture = z
  .object({
    Cookie: z.string(),
    id: z.uuid(),
    envelope: mutationEnvelopeSchema,
    receipt: mutationResponseSchema,
    phase: z.enum(["unavailable", "caught-up", "reopened", "rebuilt"]),
  })
  .parse(JSON.parse(process.env.PR0_SEARCH_RECOVERY_FIXTURE ?? "{}"));

test(`search recovery: ${fixture.phase}`, async () => {
  const client = promptClient(fixture.Cookie);
  const response = await fetch(
    `${origin}/api/v1/library/prompts?query=committed`,
    { headers: { Cookie: fixture.Cookie } }
  );
  if (fixture.phase === "unavailable") {
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toMatchObject({ code: "search_preparing" });
    const committed = await client.getPrompt(fixture.id);
    expect(committed.content).toBe("committed after indexing");
    expect(await client.mutatePrompts(fixture.envelope)).toEqual(
      fixture.receipt
    );
    return;
  }
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    prompts: [{ id: fixture.id }],
  });
  if (fixture.phase === "reopened") {
    expect(response.headers.get("Server-Timing")).toContain(
      'search-updates;desc="0"'
    );
  }
  const obsolete = await client.getPrompts({ query: "before" });
  expect(obsolete.prompts).toHaveLength(0);
});
