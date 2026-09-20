"use client";

import type { PromptView } from "@pr0/api-contract/prompts";
import { useState } from "react";

interface LibraryFilters {
  view: PromptView;
  viewCollectionId: string | null;
  collectionId: string | null;
  tagIds: string[];
  favorite: boolean;
}

export const useLibraryFilters = () => {
  const [filters, setFilters] = useState<LibraryFilters>({
    view: "all",
    viewCollectionId: null,
    collectionId: null,
    tagIds: [],
    favorite: false,
  });
  const hasExtraFilters =
    Boolean(filters.collectionId) ||
    filters.tagIds.length > 0 ||
    filters.favorite;
  return { filters, setFilters, hasExtraFilters };
};
