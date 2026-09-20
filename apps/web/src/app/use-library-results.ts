"use client";
import { PromptApiError } from "@pr0/api-client/prompts";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type {
  Collection,
  Tag,
  PromptView,
  promptPageSchema,
} from "@pr0/api-contract/prompts";
import type { z } from "zod";

import { usePromptList } from "./use-prompt-list";
import type { usePromptSearch } from "./use-prompt-search";
import { usePromptSelection } from "./use-prompt-selection";

const matchingOrganization = (
  prompts: z.infer<typeof promptPageSchema>["prompts"],
  organization: { collections: Collection[]; tags: Tag[] } | undefined,
  collectionId: string | null,
  tagIds: string[],
  incomplete: boolean
) => {
  if (!organization) {
    return { prompts, incomplete };
  }
  const availableTags = new Set(organization.tags.map((tag) => tag.id));
  if (
    (collectionId &&
      !organization.collections.some(
        (collection) => collection.id === collectionId
      )) ||
    tagIds.some((id) => !availableTags.has(id))
  ) {
    return { prompts: [], incomplete: false };
  }
  return { prompts, incomplete };
};

export const useLibraryResults = ({
  library,
  view,
  collectionId,
  tagIds,
  search,
  organization,
}: {
  library: PrivateLibrary;
  view: PromptView;
  collectionId: string | null;
  tagIds: string[];
  search: ReturnType<typeof usePromptSearch>;
  organization: { collections: Collection[]; tags: Tag[] } | undefined;
}) => {
  const { list, queryKey, restarted } = usePromptList({
    library,
    view,
    collectionId,
    tagIds,
    query: search.debounced,
    sort: search.sort,
    enabled: !search.error && !search.pending,
  });
  const searchBlocked =
    search.pending ||
    Boolean(search.error) ||
    list.isError ||
    (list.failureReason instanceof PromptApiError &&
      list.failureReason.detail?.code === "search_preparing");
  const pages = list.data?.pages ?? [];
  const usage = pages[0]?.usage;
  const { prompts, incomplete } = matchingOrganization(
    searchBlocked ? [] : pages.flatMap((page) => page.prompts),
    organization,
    collectionId,
    tagIds,
    list.isFetching || list.hasNextPage
  );
  const { selectedId, setSelected, detail } = usePromptSelection({
    query: search.error ? "" : search.debounced,
    libraryRevision: pages[0]?.revision,
    library,
    view,
    collectionId,
    tagIds,
    prompts,
    incomplete: incomplete || searchBlocked,
    loading: list.isPending || searchBlocked,
  });

  return {
    list,
    queryKey,
    restarted,
    searchBlocked,
    usage,
    prompts,
    selectedId,
    setSelected,
    detail,
  };
};
