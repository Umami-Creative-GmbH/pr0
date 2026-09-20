import { expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

import { verifyDeletionReceipt } from "./deletions";

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
