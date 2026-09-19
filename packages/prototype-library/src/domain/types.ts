/** PROTOTYPE (issue #9) — throwaway domain model, no persistence. */

export type PromptId = string;
export type CollectionId = string;
export type TagId = string;

export interface Prompt {
  id: PromptId;
  title: string;
  description: string;
  content: string;
  collectionId: CollectionId | null;
  tagIds: TagId[];
  favorite: boolean;
  archived: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  modifiedAt: number;
  /** Null until the prompt has been successfully copied at least once. */
  lastUsedAt: number | null;
  useCount: number;
}

export interface Collection {
  id: CollectionId;
  name: string;
  /** Prototype-only presentation accent, carried from the design. */
  accent: string;
}

export interface Tag {
  id: TagId;
  name: string;
}

export interface Library {
  prompts: Prompt[];
  collections: Collection[];
  tags: Tag[];
}

export type ViewKind =
  | "all"
  | "favorites"
  | "recents"
  | "archive"
  | "collection";

export type View =
  | { kind: Exclude<ViewKind, "collection"> }
  | { kind: "collection"; collectionId: CollectionId };

export type Sort =
  | "relevance"
  | "recently-used"
  | "recently-modified"
  | "newest"
  | "oldest"
  | "title";

/** Additional filters combined with the view scope using AND. */
export interface Filters {
  collectionId: CollectionId | null;
  tagIds: TagId[];
  favoriteOnly: boolean;
}

export const emptyFilters: Filters = {
  collectionId: null,
  tagIds: [],
  favoriteOnly: false,
};

/** Relevance tier 1 is the strongest match; 6 is content-only. */
export type RelevanceTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface RetrievalRequest {
  library: Library;
  view: View;
  filters: Filters;
  query: string;
  sort: Sort;
}
