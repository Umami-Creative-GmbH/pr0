import { expect, test } from "bun:test";

import { verifyDeletionReceipt } from "@pr0/api-client/deletions";
import {
  deletionTrustSchema,
  deletionResultSchema,
} from "@pr0/api-contract/deletions";
import { SQL } from "bun";
import { z } from "zod";

import { origin } from "./http-fixture";

const fixture = z
  .object({
    phase: z.enum(["blocked", "replayed"]),
    Cookie: z.string(),
    trust: deletionTrustSchema,
    initial: z.object({ status: z.number(), body: deletionResultSchema }),
  })
  .parse(JSON.parse(process.env.PR0_DELETION_RESTORE ?? "null"));

test(`ordinary restore and lost ledger copy remain safe: ${fixture.phase}`, async () => {
  expect(fixture.initial.status).toBe(200);
  expect(fixture.initial.body.status).toBe("deleted");
  const app = new SQL(process.env.DATABASE_URL ?? "");
  const a = new SQL(process.env.PR0_LEDGER_A_URL ?? "");
  const b = new SQL(process.env.PR0_LEDGER_B_URL ?? "");
  try {
    const [ready, library, lookup] = await Promise.all([
      fetch(`${origin}/api/v1/ready`),
      fetch(`${origin}/api/v1/library`, {
        headers: { Cookie: fixture.Cookie },
      }),
      fetch(`${origin}/api/v1/account-deletions/${fixture.trust.handle}`),
    ]);
    const owners =
      await app`SELECT id FROM "user" WHERE id=${fixture.trust.accountId}`;
    if (fixture.phase === "blocked") {
      expect(owners).toHaveLength(1);
      expect(ready.status).toBe(503);
      expect(library.status).toBe(503);
      expect(lookup.status).toBe(503);
    } else {
      expect(ready.status).toBe(200);
      expect(library.status).toBe(401);
      expect(owners).toHaveLength(0);
      const result = deletionResultSchema.parse(await lookup.json());
      expect(result.status).toBe("deleted");
      if (result.status !== "deleted") {
        throw new Error("Missing restored receipt");
      }
      expect(
        await verifyDeletionReceipt(result.receipt, fixture.trust)
      ).toMatchObject({ accountId: fixture.trust.accountId });
      const id = `receipt:${fixture.trust.handle}`;
      const [copyA, copyB] = await Promise.all([
        a`SELECT value FROM deletion_record WHERE instance_id=${fixture.trust.instanceId} AND id=${id}`,
        b`SELECT value FROM deletion_record WHERE instance_id=${fixture.trust.instanceId} AND id=${id}`,
      ]);
      expect(copyA).toEqual(copyB);
      expect(copyB[0]?.value).toBe(result.receipt);
    }
  } finally {
    await Promise.all([app.close(), a.close(), b.close()]);
  }
});
