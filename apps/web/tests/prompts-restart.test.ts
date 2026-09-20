import { expect, test } from "bun:test";

import { z } from "zod";

import { origin, post } from "./http-fixture";

test("a restarted production server returns persisted prompt text and the original receipt", async () => {
  const fixture = z
    .object({
      Cookie: z.string(),
      envelope: z.record(z.string(), z.unknown()),
      id: z.string(),
      receipt: z.record(z.string(), z.unknown()),
      detail: z.record(z.string(), z.unknown()),
    })
    .parse(JSON.parse(process.env.PR0_PROMPT_RESTART_FIXTURE ?? "null"));
  const detail = await fetch(`${origin}/api/v1/library/prompts/${fixture.id}`, {
    headers: { Cookie: fixture.Cookie },
  });
  expect(detail.status).toBe(200);
  expect(await detail.json()).toEqual(fixture.detail);
  const replay = await post("/api/v1/sync/mutations", fixture.envelope, {
    Cookie: fixture.Cookie,
  });
  expect(await replay.json()).toEqual(fixture.receipt);
  const list = await fetch(`${origin}/api/v1/library/prompts`, {
    headers: { Cookie: fixture.Cookie },
  });
  expect(await list.json()).toMatchObject({
    revision: "1",
    usage: { promptCount: 1 },
  });
});
