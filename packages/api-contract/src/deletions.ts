import { z } from "zod";

/** Opaque random 256-bit handle; it names a deletion status and grants no account access. */
export const deletionHandleSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

/** What a browser keeps before confirming, so a reload can still check the outcome. */
export const deletionIdentitySchema = z.strictObject({
  instanceId: z.uuid(),
  accountId: z.uuid(),
  handle: deletionHandleSchema,
});
const deletedSchema = z.strictObject({
  status: z.literal("deleted"),
  accountId: z.uuid(),
  deletedAt: z.iso.datetime(),
});
export const deletionResultSchema = deletedSchema;
export const deletionLookupSchema = z.discriminatedUnion("status", [
  deletedSchema,
  z.strictObject({ status: z.literal("absent") }),
]);
export type DeletionIdentity = z.infer<typeof deletionIdentitySchema>;
export type DeletionResult = z.infer<typeof deletionResultSchema>;
export type DeletionLookup = z.infer<typeof deletionLookupSchema>;
