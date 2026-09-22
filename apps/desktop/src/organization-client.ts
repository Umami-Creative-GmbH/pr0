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
    name_conflict:
      "An equivalent name exists. Correct the name, or explicitly confirm a tag merge.",
    validation_name:
      "Enter a name with 1–60 Unicode code points and no NUL characters.",
    quota_collection:
      "The library has reached 200 collections. Delete an unused collection to free a slot.",
    quota_tag:
      "The library has reached 1,000 tags. Use an existing tag or free a slot.",
    quota_text:
      "The library has reached 100 MiB of text. Shorten the name or free capacity.",
    quota_tags_per_prompt:
      "A prompt can have at most 20 tags. Remove one before adding another.",
    quota_exceeded:
      "The server refused this change because its quota is full. Local work is retained; correct it or free capacity.",
    results_changed:
      "The available snapshot changed. Review the counts and confirm again.",
    organization_unavailable:
      "This collection or tag is no longer available. Your prompts are kept.",
    not_found:
      "The collection, tag or prompt was removed on another device. Your saved work is retained for review.",
    outcome_uncertain:
      "The previous upload outcome is unknown. Reconnect to resolve it before correcting this change.",
    recovery_required:
      "Saved on this device before recovery. Review the restored library before confirming this change again.",
  };
  const parsed = z.string().safeParse(error);
  if (!parsed.success) {
    return "The save could not be confirmed. Retry the same action to resolve its outcome.";
  }
  const entry = Object.entries(messages).find(([code]) => code === parsed.data);
  return (
    entry?.[1] ??
    "Not saved. Check free disk space and retry; your input is retained."
  );
};
