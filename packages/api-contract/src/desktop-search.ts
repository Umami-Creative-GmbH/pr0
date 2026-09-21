import { z } from "zod";

import {
  collectionSchema,
  libraryScopeSchema,
  promptBrowseInputSchema,
  promptIdentitySchema,
  promptSortSchema,
  promptSummarySchema,
  revisionSchema,
} from "./prompts";

// Native IPC follows the existing REST retrieval semantics; it has no HTTP route.
export const desktopSearchSchema = z
  .strictObject({
    ...promptBrowseInputSchema.shape,
    ...libraryScopeSchema.shape,
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    requestId: z.uuidv4(),
    selectedId: promptIdentitySchema.optional(),
    sort: promptSortSchema.default("recently-modified"),
    tagIds: z.array(promptIdentitySchema).max(1000).default([]),
  })
  .refine(
    (input) =>
      (input.view === "collection") === Boolean(input.viewCollectionId),
    "Collection views require their identity; other views must omit it."
  );
export type DesktopSearch = z.infer<typeof desktopSearchSchema>;
export const desktopSearchPageSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  revision: revisionSchema,
  prompts: z.array(promptSummarySchema).max(100),
  nextCursor: z.string().max(2048).nullable(),
  selectedId: promptIdentitySchema.nullable(),
  collections: z.array(collectionSchema).max(200),
  tags: z.array(collectionSchema).max(1000),
});
export type DesktopSearchPage = z.infer<typeof desktopSearchPageSchema>;
