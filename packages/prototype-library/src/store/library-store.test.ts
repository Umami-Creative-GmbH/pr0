import { expect, test } from "bun:test";

import type { Library, Prompt } from "../domain/types";
import {
  createLibraryState,
  effectiveSort,
  libraryReducer,
  selectResults,
} from "./library-store";
import type { LibraryAction, LibraryState } from "./library-store";

const DAY = 86_400_000;

const prompt = (overrides: Partial<Prompt> & { id: string }): Prompt => ({
  title: "Untitled",
  description: "",
  content: "",
  collectionId: null,
  tagIds: [],
  favorite: false,
  archived: false,
  createdAt: 0,
  modifiedAt: 0,
  lastUsedAt: null,
  useCount: 0,
  ...overrides,
});

const library: Library = {
  prompts: [
    prompt({
      id: "work-a",
      title: "Summary helper",
      collectionId: "c-work",
      tagIds: ["t-writing"],
      content: "summarize the thread",
      modifiedAt: 5 * DAY,
      createdAt: 1 * DAY,
    }),
    prompt({
      id: "work-b",
      title: "Agenda builder",
      collectionId: "c-work",
      modifiedAt: 9 * DAY,
      createdAt: 3 * DAY,
    }),
    prompt({
      id: "home",
      title: "Grocery list",
      collectionId: "c-home",
      modifiedAt: 2 * DAY,
      createdAt: 2 * DAY,
      lastUsedAt: 8 * DAY,
    }),
  ],
  collections: [
    { id: "c-work", name: "Work", accent: "#0078D2" },
    { id: "c-home", name: "Home", accent: "#00D4A8" },
  ],
  tags: [{ id: "t-writing", name: "Writing" }],
};

const apply = (
  state: LibraryState,
  ...actions: LibraryAction[]
): LibraryState => {
  let current = state;
  for (const action of actions) {
    current = libraryReducer(current, action);
  }
  return current;
};

const start = () =>
  libraryReducer(createLibraryState(library), { type: "select", id: null });

// --- Sort memory ------------------------------------------------------------

test("browsing defaults to Recently modified, Recents to Recently used", () => {
  const state = start();
  expect(effectiveSort(state)).toBe("recently-modified");

  const recents = apply(state, { type: "setView", view: { kind: "recents" } });
  expect(effectiveSort(recents)).toBe("recently-used");
});

test("starting a search selects Relevance", () => {
  const state = apply(start(), { type: "setQuery", query: "summ" });
  expect(effectiveSort(state)).toBe("relevance");
});

test("an explicit search sort persists while the query is edited", () => {
  const state = apply(
    start(),
    { type: "setQuery", query: "summ" },
    { type: "setSort", sort: "oldest" },
    { type: "setQuery", query: "summa" }
  );
  expect(effectiveSort(state)).toBe("oldest");
});

test("clearing the query restores the view's browsing sort", () => {
  const state = apply(
    start(),
    { type: "setSort", sort: "title" },
    { type: "setQuery", query: "summ" },
    { type: "setSort", sort: "oldest" },
    { type: "clearQuery" }
  );
  expect(effectiveSort(state)).toBe("title");
});

test("each view remembers its own browsing sort", () => {
  const state = apply(
    start(),
    { type: "setSort", sort: "title" },
    { type: "setView", view: { kind: "collection", collectionId: "c-work" } },
    { type: "setSort", sort: "newest" }
  );
  expect(effectiveSort(state)).toBe("newest");

  const back = apply(state, { type: "setView", view: { kind: "all" } });
  expect(effectiveSort(back)).toBe("title");
});

// --- Navigation -------------------------------------------------------------

test("navigating clears the query and additional filters but keeps view scope", () => {
  const state = apply(
    start(),
    { type: "setQuery", query: "summ" },
    { type: "toggleFavoriteFilter" },
    { type: "toggleTagFilter", tagId: "t-writing" },
    { type: "setView", view: { kind: "collection", collectionId: "c-work" } }
  );

  expect(state.query).toBe("");
  expect(state.filters).toEqual({
    collectionId: null,
    tagIds: [],
    favoriteOnly: false,
  });
  expect(selectResults(state).map((found) => found.id)).toEqual([
    "work-b",
    "work-a",
  ]);
});

test("clearing filters retains the inherent view scope", () => {
  const state = apply(
    start(),
    { type: "setView", view: { kind: "collection", collectionId: "c-work" } },
    { type: "toggleFavoriteFilter" },
    { type: "clearFilters" }
  );

  expect(selectResults(state).map((found) => found.id)).toEqual([
    "work-b",
    "work-a",
  ]);
});

// --- Selection --------------------------------------------------------------

test("selects the first result when nothing is selected yet", () => {
  expect(start().selectedId).toBe("work-b");
});

test("keeps the selected prompt while it stays eligible", () => {
  const state = apply(
    start(),
    { type: "select", id: "work-a" },
    { type: "setSort", sort: "title" }
  );
  expect(state.selectedId).toBe("work-a");
});

test("moves selection to the first result when the selection stops qualifying", () => {
  const state = apply(
    start(),
    { type: "select", id: "home" },
    { type: "setView", view: { kind: "collection", collectionId: "c-work" } }
  );
  expect(state.selectedId).toBe("work-b");
});

test("selects nothing when no results remain", () => {
  const state = apply(start(), { type: "setQuery", query: "nothing matches" });
  expect(state.selectedId).toBeNull();
  expect(selectResults(state)).toEqual([]);
});

test("keyboard movement wraps through the current results", () => {
  const state = apply(start(), { type: "select", id: "work-b" });
  expect(apply(state, { type: "move", delta: 1 }).selectedId).toBe("work-a");
  expect(apply(state, { type: "move", delta: -1 }).selectedId).toBe("home");
});

// --- Filters ----------------------------------------------------------------

test("tag filters toggle on and off", () => {
  const on = apply(start(), { type: "toggleTagFilter", tagId: "t-writing" });
  expect(on.filters.tagIds).toEqual(["t-writing"]);
  expect(selectResults(on).map((found) => found.id)).toEqual(["work-a"]);

  const off = apply(on, { type: "toggleTagFilter", tagId: "t-writing" });
  expect(off.filters.tagIds).toEqual([]);
});

test("a no-match result keeps the query and filters visible", () => {
  const state = apply(
    start(),
    { type: "setQuery", query: "summ" },
    { type: "setCollectionFilter", collectionId: "c-home" }
  );

  expect(selectResults(state)).toEqual([]);
  expect(state.query).toBe("summ");
  expect(state.filters.collectionId).toBe("c-home");
});
