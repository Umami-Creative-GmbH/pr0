// Reproducible interoperability vectors. RFC 8032 test key, never a service key.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";

const key = (seed: string) =>
  createPrivateKey({
    key: Buffer.from(`302e020100300506032b657004220420${seed}`, "hex"),
    format: "der",
    type: "pkcs8",
  });
const root = key(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
);
const next = key(
  "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb"
);
const instanceId = "11111111-1111-4111-8111-111111111111";
const kid = "22222222-2222-4222-8222-222222222222";
const nextKid = "55555555-5555-4555-8555-555555555555";
const claims = {
  version: 1,
  instanceId,
  accountId: "33333333-3333-4333-8333-333333333333",
  handle: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  deletionId: "77777777-7777-4777-8777-777777777777",
  deletedAt: "2000-01-01T00:00:00.000Z",
};
const compact = (
  privateKey: ReturnType<typeof key>,
  header: { alg: string; typ: string; kid: string },
  payload:
    | typeof claims
    | {
        version: number;
        instanceId: string;
        oldKid: string;
        newKid: string;
        key: typeof nextKey;
      }
) => {
  const input = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString("base64url")}`;
};
const header = { alg: "Ed25519", typ: "pr0-account-deletion+jws", kid };
const anchor = { ...createPublicKey(root).export({ format: "jwk" }), kid };
const nextKey = {
  ...createPublicKey(next).export({ format: "jwk" }),
  kid: nextKid,
};
const rotation = compact(
  root,
  { ...header, typ: "pr0-deletion-key-rotation+jws" },
  { version: 1, instanceId, oldKid: kid, newKid: nextKid, key: nextKey }
);
const receipt = compact(root, header, claims);
await Bun.write(
  new URL(
    "../../../packages/api-contract/src/deletion-proof-fixtures.json",
    import.meta.url
  ),
  `${JSON.stringify(
    {
      anchor,
      claims,
      receipt,
      rotatedReceipt: compact(next, { ...header, kid: nextKid }, claims),
      verification: { instanceId, anchor, rotations: [rotation] },
      invalidReceipts: [
        compact(root, { ...header, alg: "EdDSA" }, claims),
        compact(
          root,
          { ...header, typ: "pr0-deletion-key-rotation+jws" },
          claims
        ),
        compact(next, header, claims),
        compact(root, header, { ...claims, accountId: nextKid }),
        compact(root, header, { ...claims, instanceId: nextKid }),
        compact(root, header, {
          ...claims,
          handle: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        }),
        compact(next, { ...header, kid: nextKid }, claims),
      ],
    },
    null,
    2
  )}\n`
);
