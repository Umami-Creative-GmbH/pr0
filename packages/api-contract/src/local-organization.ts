import { z } from "zod";

import { organizationNameSchema } from "./organization";
import {
  collectionSchema,
  mutationEnvelopeSchema,
  organizationEffectSchema,
  organizationStateSchema,
  promptSchema,
  promptErrorSchema,
  revisionSchema,
} from "./prompts";

const named = { id: z.uuidv4(), name: organizationNameSchema };
export const organizationActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("collection.create"), ...named }),
  z.strictObject({ kind: z.literal("collection.rename"), ...named }),
  z.strictObject({ kind: z.literal("tag.create"), ...named }),
  z.strictObject({ kind: z.literal("tag.rename"), ...named }),
  z.strictObject({ kind: z.literal("collection.delete"), id: z.uuidv4() }),
  z.strictObject({ kind: z.literal("tag.delete"), id: z.uuidv4() }),
  z.strictObject({
    kind: z.literal("tag.merge"),
    id: z.uuidv4(),
    targetId: z.uuidv4(),
  }),
  z.strictObject({
    kind: z.literal("prompt.collection"),
    id: z.uuidv4(),
    collectionId: z.uuidv4().nullable(),
  }),
  z.strictObject({
    kind: z.literal("prompt.tags"),
    id: z.uuidv4(),
    add: z.array(z.uuidv4()).max(20),
    remove: z.array(z.uuidv4()).max(20),
  }),
]);
export const organizeRequestSchema = z.strictObject({
  instanceId: z.uuid(),
  accountId: z.uuid(),
  generation: z.number().int().nonnegative(),
  operationId: z.uuidv4(),
  action: organizationActionSchema,
  replaces: z.uuidv4().nullable().optional(),
  expectedLocalRevision: revisionSchema.nullable().optional(),
});
export const localOrganizationSchema = z.strictObject({
  instanceId: z.uuid(),
  accountId: z.uuid(),
  revision: revisionSchema,
  localRevision: revisionSchema,
  collections: z.array(collectionSchema),
  tags: z.array(collectionSchema),
  textBytes: z.number().int().nonnegative(),
  complete: z.boolean(),
  states: z.array(organizationStateSchema),
  effects: z
    .array(
      z.strictObject({
        id: z.uuidv4(),
        effect: organizationEffectSchema,
        accepted: z.boolean(),
      })
    )
    .max(100),
  pending: z.array(
    z.strictObject({
      id: z.uuidv4(),
      operation: mutationEnvelopeSchema.shape.operations.element,
      error: z.string().nullable(),
      failure: promptErrorSchema.nullable().optional(),
      accepted: z.boolean(),
    })
  ),
});
export const organizeResultSchema = z.strictObject({
  id: z.uuidv4(),
  existing: z.boolean(),
  effect: organizationEffectSchema.nullable(),
});
export const organizationLocalImpactSchema = z.strictObject({
  localRevision: revisionSchema,
  effect: organizationEffectSchema,
});
export const organizationLocalReviewSchema = z.strictObject({
  operationId: z.uuidv4(),
  effect: organizationEffectSchema,
  prompts: z
    .array(
      z.strictObject({
        id: z.uuidv4(),
        originallyArchived: z.boolean(),
        current: promptSchema.nullable(),
      })
    )
    .max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type OrganizationAction = z.infer<typeof organizationActionSchema>;
export type OrganizeRequest = z.infer<typeof organizeRequestSchema>;
export type LocalOrganization = z.infer<typeof localOrganizationSchema>;
export type OrganizationLocalImpact = z.infer<
  typeof organizationLocalImpactSchema
>;
export type OrganizationLocalReview = z.infer<
  typeof organizationLocalReviewSchema
>;
