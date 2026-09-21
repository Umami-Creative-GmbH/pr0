import { expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  deletionClaimsSchema,
  deletionTrustSchema,
} from "@pr0/api-contract/deletions";

import vectors from "../../api-contract/src/deletion-proof-fixtures.json";
import { verifyDeletionReceipt } from "./deletions";

test("native and browser receipt vectors share irreversible deletion and signed rotation semantics", async () => {
  const claims = deletionClaimsSchema.parse(vectors.claims);
  const trust = deletionTrustSchema.parse({
    ...vectors.verification,
    accountId: vectors.claims.accountId,
    handle: vectors.claims.handle,
  });
  expect(await verifyDeletionReceipt(vectors.receipt, trust)).toEqual(claims);
  expect(await verifyDeletionReceipt(vectors.rotatedReceipt, trust)).toEqual(
    claims
  );
  for (const receipt of vectors.invalidReceipts) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each independently invalid signed vector must fail.
    await expect(
      verifyDeletionReceipt(receipt, { ...trust, rotations: [] })
    ).rejects.toThrow();
  }
  await expect(
    verifyDeletionReceipt(vectors.rotatedReceipt, {
      ...trust,
      rotations: [...trust.rotations, ...trust.rotations],
    })
  ).rejects.toThrow();
});

test("receipt verification rejects other identities, unsigned evidence and the wrong JOSE type", async () => {
  const pair = generateKeyPairSync("ed25519");
  const kid = "00000000-0000-4000-8000-000000000001";
  const instanceId = "00000000-0000-4000-8000-000000000002";
  const accountId = "00000000-0000-4000-8000-000000000003";
  const handle = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const payload = {
    version: 1 as const,
    instanceId,
    accountId,
    handle,
    deletionId: "00000000-0000-4000-8000-000000000004",
    deletedAt: "2026-09-20T00:00:00.000Z",
  };
  const publicKey = pair.publicKey.export({ format: "jwk" });
  const trust = {
    instanceId,
    accountId,
    handle,
    anchor: {
      kty: "OKP" as const,
      crv: "Ed25519" as const,
      kid,
      x: String(publicKey.x),
    },
    rotations: [],
  };
  const token = (typ: string) => {
    const input = `${Buffer.from(JSON.stringify({ alg: "Ed25519", kid, typ })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    return `${input}.${sign(null, Buffer.from(input), pair.privateKey).toString("base64url")}`;
  };
  expect(
    await verifyDeletionReceipt(token("pr0-account-deletion+jws"), trust)
  ).toEqual(payload);
  await expect(
    verifyDeletionReceipt(token("pr0-account-deletion+jws"), {
      ...trust,
      accountId: kid,
    })
  ).rejects.toThrow();
  await expect(
    verifyDeletionReceipt(token("pr0-deletion-key-rotation+jws"), trust)
  ).rejects.toThrow();
  await expect(
    verifyDeletionReceipt('{"status":"absent"}', trust)
  ).rejects.toThrow();
});
