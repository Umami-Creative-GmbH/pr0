/**
 * PROTOTYPE (issue #9) — in-memory library UI state.
 *
 * Encodes the navigation, sort-memory and selection rules agreed in issue #7.
 * Nothing here persists; reloading the prototype restores the seed.
 */

import { resolveSelection } from "../domain/copy";
import { retrieve } from "../domain/retrieval";
import type {
  CollectionId,
  Filters,
  Library,
  Prompt,
  PromptId,
  Sort,
  TagId,
  View,
} from "../domain/types";
import { emptyFilters } from "../domain/types";

export type ViewKey = string;

export const viewKey = (view: View): ViewKey =>
  view.kind === "collection" ? `collection:${view.collectionId}` : view.kind;

/** Recents exists to show what was used, so it browses by Recently used. */
export const defaultBrowsingSort = (view: View): Sort =>
  view.kind === "recents" ? "recently-used" : "recently-modified";

export interface LibraryState {
  library: Library;
  view: View;
  query: string;
  filters: Filters;
  /** Explicit sort chosen while a query is active; null means Relevance. */
  searchSort: Sort | null;
  /** Remembered browsing sort, per view. */
  browsingSort: Record<ViewKey, Sort>;
  selectedId: PromptId | null;
}

export const createLibraryState = (library: Library): LibraryState => {
  const view: View = { kind: "all" };
  return {
    library,
    view,
    query: "",
    filters: emptyFilters,
    searchSort: null,
    browsingSort: {},
    selectedId: null,
  };
};

export type LibraryAction =
  | { type: "setLibrary"; library: Library }
  | { type: "setView"; view: View }
  | { type: "setQuery"; query: string }
  | { type: "clearQuery" }
  | { type: "setSort"; sort: Sort }
  | { type: "resetSort" }
  | { type: "setCollectionFilter"; collectionId: CollectionId | null }
  | { type: "toggleTagFilter"; tagId: TagId }
  | { type: "toggleFavoriteFilter" }
  | { type: "clearFilters" }
  | { type: "select"; id: PromptId | null }
  | { type: "move"; delta: number };

const hasQuery = (query: string): boolean => query.trim() !== "";

/** The sort actually applied: Relevance while searching, else the browsing sort. */
export const effectiveSort = (state: LibraryState): Sort => {
  if (hasQuery(state.query)) {
    return state.searchSort ?? "relevance";
  }
  return (
    state.browsingSort[viewKey(state.view)] ?? defaultBrowsingSort(state.view)
  );
};

export const selectResults = (state: LibraryState): Prompt[] =>
  retrieve({
    library: state.library,
    view: state.view,
    filters: state.filters,
    query: state.query,
    sort: effectiveSort(state),
  });

export const hasActiveFilters = (filters: Filters): boolean =>
  filters.collectionId !== null ||
  filters.tagIds.length > 0 ||
  filters.favoriteOnly;

type FilterAction = Extract<
  LibraryAction,
  { type: "setCollectionFilter" | "toggleTagFilter" | "toggleFavoriteFilter" }
>;

/** Split out so the main reducer stays within the complexity budget. */
const reduceFilters = (filters: Filters, action: FilterAction): Filters => {
  if (action.type === "setCollectionFilter") {
    return { ...filters, collectionId: action.collectionId };
  }
  if (action.type === "toggleFavoriteFilter") {
    return { ...filters, favoriteOnly: !filters.favoriteOnly };
  }
  const active = filters.tagIds.includes(action.tagId);
  return {
    ...filters,
    tagIds: active
      ? filters.tagIds.filter((tagId) => tagId !== action.tagId)
      : [...filters.tagIds, action.tagId],
  };
};

const reduceWithoutSelection = (
  state: LibraryState,
  action: LibraryAction
): LibraryState => {
  switch (action.type) {
    case "setLibrary": {
      return { ...state, library: action.library };
    }

    // Navigating clears the query and additional filters, and applies the
    // target view's remembered browsing sort.
    case "setView": {
      return {
        ...state,
        view: action.view,
        query: "",
        filters: emptyFilters,
        searchSort: null,
      };
    }

    // Starting a search selects Relevance; editing an existing query keeps a
    // chosen explicit search sort.
    case "setQuery": {
      return {
        ...state,
        query: action.query,
        searchSort: hasQuery(state.query) ? state.searchSort : null,
      };
    }

    // Clearing the query restores the browsing sort.
    case "clearQuery": {
      return { ...state, query: "", searchSort: null };
    }

    case "setSort": {
      return hasQuery(state.query)
        ? { ...state, searchSort: action.sort }
        : {
            ...state,
            browsingSort: {
              ...state.browsingSort,
              [viewKey(state.view)]: action.sort,
            },
          };
    }

    case "resetSort": {
      return hasQuery(state.query)
        ? { ...state, searchSort: null }
        : {
            ...state,
            browsingSort: {
              ...state.browsingSort,
              [viewKey(state.view)]: defaultBrowsingSort(state.view),
            },
          };
    }

    case "setCollectionFilter":
    case "toggleTagFilter":
    case "toggleFavoriteFilter": {
      return { ...state, filters: reduceFilters(state.filters, action) };
    }

    // Clearing additional filters retains the view's inherent scope.
    case "clearFilters": {
      return { ...state, filters: emptyFilters };
    }

    case "select": {
      return { ...state, selectedId: action.id };
    }

    case "move": {
      const results = selectResults(state);
      if (results.length === 0) {
        return { ...state, selectedId: null };
      }
      const current = results.findIndex(
        (prompt) => prompt.id === state.selectedId
      );
      const from = current === -1 ? 0 : current;
      const next = (from + action.delta + results.length) % results.length;
      return { ...state, selectedId: results[next]?.id ?? null };
    }

    default: {
      return state;
    }
  }
};

/**
 * Applies the action, then re-resolves the selection so it follows prompt
 * identity while eligible, falls back to the first result, or clears.
 */
export const libraryReducer = (
  state: LibraryState,
  action: LibraryAction
): LibraryState => {
  const next = reduceWithoutSelection(state, action);
  if (action.type === "move") {
    return next;
  }
  const selectedId = resolveSelection(next.selectedId, selectResults(next));
  return selectedId === next.selectedId ? next : { ...next, selectedId };
};
