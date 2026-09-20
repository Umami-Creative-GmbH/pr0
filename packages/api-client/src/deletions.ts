// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Verify continuity from the pinned anchor in signed predecessor order.
import {
  compactJwsSchema,
  deletionClaimsSchema,
  deletionKeySchema,
  deletionRotationSchema,
} from "@pr0/api-contract/deletions";
import type { DeletionKey, DeletionTrust } from "@pr0/api-contract/deletions";
import { z } from "zod";

const decode = (value: string) =>
  Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.codePointAt(0) ?? 0
  );
const parse = <T>(value: string, schema: z.ZodType<T>): T =>
  schema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(value)))
  );
const headerSchema = z.strictObject({
  alg: z.literal("Ed25519"),
  typ: z.string(),
  kid: z.uuid(),
});
const verifiedPayload = async (
  receipt: string,
  typ: string,
  keys: Map<string, DeletionKey>
) => {
  const parts = compactJwsSchema.parse(receipt).split(".");
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("Invalid deletion evidence");
  }
  const header = parse(headerPart, headerSchema);
  const publicKey = keys.get(header.kid);
  if (header.typ !== typ || !publicKey) {
    throw new Error("Untrusted deletion evidence");
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    deletionKeySchema.parse(publicKey),
    "Ed25519",
    false,
    ["verify"]
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      key,
      decode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`)
    ))
  ) {
    throw new Error("Invalid deletion signature");
  }
  // Payload has no authority and is not parsed until its exact signing input verifies.
  return { kid: header.kid, payload: payloadPart };
};
export const verifyDeletionKeys = async (
  trust: Pick<DeletionTrust, "instanceId" | "anchor" | "rotations">
) => {
  const anchor = deletionKeySchema.parse(trust.anchor);
  const keys = new Map([[anchor.kid, anchor]]);
  let previous = anchor.kid;
  for (const statement of trust.rotations) {
    const verified = await verifiedPayload(
      statement,
      "pr0-deletion-key-rotation+jws",
      keys
    );
    const rotation = parse(verified.payload, deletionRotationSchema);
    if (
      rotation.instanceId !== trust.instanceId ||
      rotation.oldKid !== previous ||
      verified.kid !== previous ||
      rotation.newKid !== rotation.key.kid ||
      keys.has(rotation.newKid)
    ) {
      throw new Error("Invalid deletion key continuity");
    }
    keys.set(rotation.newKid, rotation.key);
    previous = rotation.newKid;
  }
  return keys;
};
export const verifyDeletionReceipt = async (
  receipt: string,
  trust: DeletionTrust
) => {
  const keys = await verifyDeletionKeys(trust);
  const verified = await verifiedPayload(
    receipt,
    "pr0-account-deletion+jws",
    keys
  );
  const result = parse(verified.payload, deletionClaimsSchema);
  if (
    result.instanceId !== trust.instanceId ||
    result.accountId !== trust.accountId ||
    result.handle !== trust.handle
  ) {
    throw new Error("Deletion belongs to another account or instance");
  }
  return result;
};
