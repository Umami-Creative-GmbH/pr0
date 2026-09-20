// oxlint-disable react-doctor/server-sequential-independent-await, eslint/no-await-in-loop, react-doctor/async-await-in-loop -- A key chain is validated and extended in predecessor order.
import "server-only";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";

import { verifyDeletionKeys } from "@pr0/api-client/deletions";
import { deletionKeySchema } from "@pr0/api-contract/deletions";
import type { DeletionClaims, DeletionKey } from "@pr0/api-contract/deletions";
import { z } from "zod";

import { database } from "./database";
import { appendEvidence, readEvidence } from "./deletion-ledger";

const signingKeySchema = z.strictObject({
  key: deletionKeySchema,
  privateKey: z.string(),
  rotation: z.string().nullable(),
});
type SigningKey = z.infer<typeof signingKeySchema>;
const newKey = (): SigningKey => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    key: deletionKeySchema.parse({
      ...publicKey.export({ format: "jwk" }),
      kid: crypto.randomUUID(),
    }),
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    rotation: null,
  };
};
const compact = (
  key: SigningKey,
  typ: string,
  payload:
    | DeletionClaims
    | {
        version: 1;
        instanceId: string;
        oldKid: string;
        newKid: string;
        key: DeletionKey;
      }
) => {
  const header = Buffer.from(
    JSON.stringify({ alg: "Ed25519", typ, kid: key.key.kid })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${header}.${body}`;
  return `${input}.${sign(null, Buffer.from(input), createPrivateKey(key.privateKey)).toString("base64url")}`;
};
export const initializeSigningKey = async (instanceId: string) => {
  const [instance] =
    await database()`SELECT deletion_anchor FROM instance WHERE id=${instanceId}`;
  if (!(await readEvidence(instanceId, "key:0000000000"))) {
    if (instance?.deletion_anchor) {
      throw new Error("Previously initialized signing anchor is missing");
    }
    await appendEvidence(
      instanceId,
      "key:0000000000",
      JSON.stringify(newKey())
    );
  }
  const root = await readEvidence(instanceId, "key:0000000000");
  const anchor = signingKeySchema.parse(JSON.parse(root ?? "null")).key;
  await database()`UPDATE instance SET deletion_anchor=${JSON.stringify(anchor)} WHERE id=${instanceId} AND deletion_anchor IS NULL`;
};
export const signingKeys = async (instanceId: string) => {
  const first = await readEvidence(instanceId, "key:0000000000");
  if (!first) {
    throw new Error("Deletion signing anchor unavailable");
  }
  const anchor = signingKeySchema.parse(JSON.parse(first));
  const [instance] =
    await database()`SELECT deletion_anchor FROM instance WHERE id=${instanceId}`;
  if (instance?.deletion_anchor !== JSON.stringify(anchor.key)) {
    throw new Error("Deletion signing anchor changed");
  }
  let current = anchor;
  const rotations: string[] = [];
  let generation = 1;
  while (true) {
    const next = await readEvidence(
      instanceId,
      `key:${String(generation).padStart(10, "0")}`
    );
    if (!next) {
      break;
    }
    current = signingKeySchema.parse(JSON.parse(next));
    if (!current.rotation) {
      throw new Error("Missing key continuity");
    }
    rotations.push(current.rotation);
    generation += 1;
  }
  const trusted = await verifyDeletionKeys({
    instanceId,
    anchor: anchor.key,
    rotations,
  });
  const publicKey = createPublicKey(current.privateKey).export({
    format: "jwk",
  });
  if (publicKey.x !== current.key.x || !trusted.has(current.key.kid)) {
    throw new Error("Signing key does not match retained continuity");
  }
  return { anchor: anchor.key, current, rotations, generation };
};
export const rotateSigningKey = async (instanceId: string) => {
  const chain = await signingKeys(instanceId);
  const next = newKey();
  next.rotation = compact(chain.current, "pr0-deletion-key-rotation+jws", {
    version: 1,
    instanceId,
    oldKid: chain.current.key.kid,
    newKid: next.key.kid,
    key: next.key,
  });
  await appendEvidence(
    instanceId,
    `key:${String(chain.generation).padStart(10, "0")}`,
    JSON.stringify(next)
  );
};
export const signDeletion = (key: SigningKey, claims: DeletionClaims) =>
  compact(key, "pr0-account-deletion+jws", claims);
