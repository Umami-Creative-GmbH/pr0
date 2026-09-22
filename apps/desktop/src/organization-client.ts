import { excerptSchema } from "@pr0/api-contract/excerpt";
import {
  localOrganizationSchema,
  organizeRequestSchema,
  organizeResultSchema,
  organizationActionSchema,
  organizationLocalImpactSchema,
  organizationLocalReviewSchema,
} from "@pr0/api-contract/local-organization";
import type {
  OrganizeRequest,
  OrganizationAction,
} from "@pr0/api-contract/local-organization";
import { organizationSearch } from "@pr0/api-contract/organization";
import { translate } from "@pr0/ui/lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const organizationMatches = (name: string, query: string) =>
  organizationSearch(name).includes(organizationSearch(query));
export const organizationClient = {
  snapshot: async () =>
    localOrganizationSchema.parse(await invoke("library_organization")),
  save: async (request: OrganizeRequest) => {
    const input = organizeRequestSchema.safeParse(request);
    if (!input.success) {
      throw new Error("validation_name");
    }
    return organizeResultSchema.parse(
      await invoke("library_organize", { request: input.data })
    );
  },
  impact: async (action: OrganizationAction, replaces: string | null = null) =>
    organizationLocalImpactSchema.parse(
      await invoke("library_organization_impact", {
        action: organizationActionSchema.parse(action),
        replaces,
      })
    ),
  review: async (id: string, offset = 0) =>
    organizationLocalReviewSchema.parse(
      await invoke("library_organization_review", {
        id: z.uuidv4().parse(id),
        offset,
      })
    ),
  browse: async (
    offset: number,
    recents: boolean,
    collectionId: string | null,
    tagIds: string[]
  ) =>
    z
      .array(
        z.strictObject({
          id: z.uuidv4(),
          title: z.string(),
          archived: z.boolean(),
          excerpt: excerptSchema,
        })
      )
      .max(50)
      .parse(
        await invoke("library_organization_browse", {
          request: { offset, recents, collectionId, tagIds },
        })
      ),
};
// Native errors are an untrusted boundary; never display server-provided text as a successful save.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native invoke rejects with untrusted values; parse the boundary here.
export const organizationError = (error: unknown): string => {
  const messages = {
    name_conflict: translate(
      "anEquivalentNameExistsCorrectTheNameOrExplicitlyConfirm"
    ),
    validation_name: translate("enterANameWith160UnicodeCodePointsAnd"),
    quota_collection: translate(
      "theLibraryHasReached200CollectionsDeleteAnUnusedCollection"
    ),
    quota_tag: translate("theLibraryHasReached1000TagsUseAnExisting"),
    quota_text: translate("theLibraryHasReached100MibOfTextShortenThe"),
    quota_tags_per_prompt: translate("aPromptCanHaveAtMost20TagsRemoveOne"),
    quota_exceeded: translate(
      "theServerRefusedThisChangeBecauseItsQuotaIsFull"
    ),
    results_changed: translate(
      "theAvailableSnapshotChangedReviewTheCountsAndConfirmAgain"
    ),
    organization_unavailable: translate(
      "thisCollectionOrTagIsNoLongerAvailableYourPrompts"
    ),
    not_found: translate("theCollectionTagOrPromptWasRemovedOnAnotherDevice"),
    outcome_uncertain: translate(
      "thePreviousUploadOutcomeIsUnknownReconnectToResolveIt"
    ),
    recovery_required: translate(
      "savedOnThisDeviceBeforeRecoveryReviewTheRestoredLibrary"
    ),
  };
  const parsed = z.string().safeParse(error);
  if (!parsed.success) {
    return translate("theSaveCouldNotBeConfirmedRetryTheSameAction");
  }
  const entry = Object.entries(messages).find(([code]) => code === parsed.data);
  return entry?.[1] ?? translate("notSavedCheckFreeDiskSpaceAndRetryYourInput");
};
