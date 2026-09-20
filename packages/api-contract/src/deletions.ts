import { z } from "zod";

export const deletionHandleSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const deletionKeySchema = z.strictObject({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: deletionHandleSchema,
  kid: z.uuid(),
});
export const deletionClaimsSchema = z.strictObject({
  version: z.literal(1),
  instanceId: z.uuid(),
  accountId: z.uuid(),
  handle: deletionHandleSchema,
  deletionId: z.uuid(),
  deletedAt: z.iso.datetime(),
});
export const compactJwsSchema = z
  .string()
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/u);
export const deletionTrustSchema = z.strictObject({
  instanceId: z.uuid(),
  accountId: z.uuid(),
  handle: deletionHandleSchema,
  anchor: deletionKeySchema,
  rotations: z.array(compactJwsSchema),
});
export const deletionVerificationSchema = z.strictObject({
  instanceId: z.uuid(),
  anchor: deletionKeySchema,
  rotations: z.array(compactJwsSchema),
});
export const deletionResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("deleted"), receipt: compactJwsSchema }),
  z.strictObject({
    status: z.literal("pending"),
    handle: deletionHandleSchema,
    retryAfter: z.number().int().positive(),
  }),
]);
export const deletionLookupSchema = z.union([
  z.strictObject({ status: z.literal("deleted"), receipt: compactJwsSchema }),
  z.strictObject({ status: z.literal("absent") }),
]);
export const deletionRotationSchema = z.strictObject({
  version: z.literal(1),
  instanceId: z.uuid(),
  oldKid: z.uuid(),
  newKid: z.uuid(),
  key: deletionKeySchema,
});
export type DeletionClaims = z.infer<typeof deletionClaimsSchema>;
export type DeletionKey = z.infer<typeof deletionKeySchema>;
export type DeletionTrust = z.infer<typeof deletionTrustSchema>;
