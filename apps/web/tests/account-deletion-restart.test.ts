import { expect, test } from "bun:test";

import { verifyDeletionReceipt } from "@pr0/api-client/deletions";
import {
  deletionLookupSchema,
  deletionTrustSchema,
} from "@pr0/api-contract/deletions";
import { z } from "zod";

import { origin } from "./http-fixture";

const fixture = z
  .object({
    stage: z.string(),
    Cookie: z.string(),
    trust: deletionTrustSchema,
    initial: z.object({
      status: z.number(),
      body: z.object({ status: z.string().optional() }),
    }),
  })
  .parse(JSON.parse(process.env.PR0_DELETION_RESTART ?? "null"));
test(`restart recovers the ${fixture.stage} durable boundary without account authority`, async () => {
  const lookup = await fetch(
    `${origin}/api/v1/account-deletions/${fixture.trust.handle}`
  );
  const result = deletionLookupSchema.parse(await lookup.json());
  const library = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: fixture.Cookie },
  });
  if (fixture.stage === "barrier") {
    expect(fixture.initial.status).toBe(503);
    expect(result.status).toBe("absent");
    expect(library.status).toBe(200);
  } else {
    expect(fixture.initial.status).toBe(202);
    expect(fixture.initial.body.status).toBe("pending");
    expect(result.status).toBe("deleted");
    if (result.status !== "deleted") {
      throw new Error("Missing completion");
    }
    const verified = await verifyDeletionReceipt(result.receipt, fixture.trust);
    expect(verified.accountId).toBe(fixture.trust.accountId);
    expect(library.status).toBe(401);
  }
});
