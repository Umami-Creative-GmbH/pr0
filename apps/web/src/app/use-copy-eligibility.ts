import { organizationSearch } from "@pr0/api-contract/organization";
import type {
  Collection,
  Prompt,
  PromptView,
  Tag,
} from "@pr0/api-contract/prompts";
import { useEffect, useRef } from "react";

export const useCopyEligibility = (input: {
  accountAvailable: boolean;
  searchBlocked: boolean;
  view: PromptView;
  collectionId: string | null;
  viewCollectionId: string | null;
  tagIds: string[];
  favorite: boolean;
  query: string;
  collections: Collection[];
  tags: Tag[];
  prompts: { id: string }[];
  selectedId: string | null;
}) => {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  }, [input]);
  return (prompt: Prompt) => {
    const state = latest.current;
    const assigned = new Set(prompt.tagIds);
    const fields = [
      prompt.title,
      prompt.description,
      prompt.content,
      state.collections.find(
        (collection) => collection.id === prompt.collectionId
      )?.name ?? "",
      ...state.tags.flatMap((tag) => (assigned.has(tag.id) ? [tag.name] : [])),
    ].map(organizationSearch);
    return (
      state.accountAvailable &&
      !state.searchBlocked &&
      prompt.archived === (state.view === "archive") &&
      (state.view !== "favorites" || prompt.favorite) &&
      (!state.favorite || prompt.favorite) &&
      (state.view !== "recents" || prompt.lastUsedAt !== null) &&
      (!state.collectionId || prompt.collectionId === state.collectionId) &&
      (!state.viewCollectionId ||
        prompt.collectionId === state.viewCollectionId) &&
      state.tagIds.every((id) => assigned.has(id)) &&
      organizationSearch(state.query)
        .split(" ")
        .filter(Boolean)
        .every((term) => fields.some((field) => field.includes(term))) &&
      (state.prompts.some((entry) => entry.id === prompt.id) ||
        state.selectedId === prompt.id)
    );
  };
};
