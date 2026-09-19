import { expect, test } from "bun:test";

import { retrieve } from "./retrieval";
import type { Filters, Library, Prompt, Sort, View } from "./types";
import { emptyFilters } from "./types";

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

const library = (prompts: Prompt[]): Library => ({
  prompts,
  collections: [
    { id: "c-german", name: "German", accent: "#E60096" },
    { id: "c-work", name: "Work", accent: "#0078D2" },
    { id: "c-marketing", name: "Marketing", accent: "#FF8900" },
  ],
  tags: [
    { id: "t-german", name: "German" },
    { id: "t-writing", name: "Writing" },
  ],
});

const run = (
  lib: Library,
  options: {
    view?: View;
    filters?: Partial<Filters>;
    query?: string;
    sort?: Sort;
  } = {}
): string[] =>
  retrieve({
    library: lib,
    view: options.view ?? { kind: "all" },
    filters: { ...emptyFilters, ...options.filters },
    query: options.query ?? "",
    sort: options.sort ?? "relevance",
  }).map((found) => found.id);

// --- Ranking fixture from issue #7 -----------------------------------------

const rankingLibrary = library([
  prompt({ id: "tier1", title: "German email" }),
  prompt({ id: "tier2", title: "Email templates in German" }),
  prompt({ id: "tier3", title: "Email reply", tagIds: ["t-german"] }),
  prompt({
    id: "tier4",
    title: "Reply template",
    collectionId: "c-german",
    content: "email",
  }),
  prompt({
    id: "tier5",
    title: "Response template",
    description: "German email",
  }),
  prompt({ id: "tier6", title: "Translation helper", content: "German email" }),
  prompt({ id: "partial", title: "German only", content: "nothing else here" }),
]);

test("ranks the issue #7 relevance fixture by tier", () => {
  expect(run(rankingLibrary, { query: "German email" })).toEqual([
    "tier1",
    "tier2",
    "tier3",
    "tier4",
    "tier5",
    "tier6",
  ]);
});

test("excludes a prompt that matches only some query terms", () => {
  expect(run(rankingLibrary, { query: "German email" })).not.toContain(
    "partial"
  );
});

test("word order in the title does not change the tier", () => {
  const reordered = library([
    prompt({ id: "a", title: "German email templates" }),
    prompt({ id: "b", title: "Email templates in German" }),
  ]);
  // Both are tier 2; the tie-break falls through to normalized title A-Z.
  expect(run(reordered, { query: "German email" })).toEqual(["b", "a"]);
});

test("a content-only match never overtakes a title match by repetition", () => {
  const lib = library([
    prompt({ id: "title", title: "German email" }),
    prompt({
      id: "spam",
      title: "Unrelated",
      content: "german email ".repeat(50),
    }),
  ]);
  expect(run(lib, { query: "German email" })).toEqual(["title", "spam"]);
});

// --- Matching ---------------------------------------------------------------

test("requires every query term somewhere, across different fields", () => {
  const lib = library([
    prompt({ id: "tagged", title: "Email reply", tagIds: ["t-german"] }),
  ]);
  expect(run(lib, { query: "German email" })).toEqual(["tagged"]);

  const untagged = library([prompt({ id: "tagged", title: "Email reply" })]);
  expect(run(untagged, { query: "German email" })).toEqual([]);
});

test("matches partial words by substring", () => {
  const lib = library([prompt({ id: "s", title: "Summarize notes" })]);
  expect(run(lib, { query: "summ" })).toEqual(["s"]);
});

test("normalizes accents and sharp s in both query and value", () => {
  const lib = library([
    prompt({ id: "cafe", title: "Café guide" }),
    prompt({ id: "ueber", title: "Über uns" }),
    prompt({ id: "strasse", title: "Straßenverkehr" }),
  ]);
  expect(run(lib, { query: "  CAFE  " })).toEqual(["cafe"]);
  expect(run(lib, { query: "uber" })).toEqual(["ueber"]);
  expect(run(lib, { query: "strasse" })).toEqual(["strasse"]);
  expect(run(lib, { query: "ueber" })).toEqual([]);
});

test("treats punctuation literally", () => {
  const lib = library([
    prompt({ id: "cpp", title: "Review", content: "explain C++ templates" }),
    prompt({ id: "c", title: "Review C", content: "explain C templates" }),
  ]);
  expect(run(lib, { query: "C++" })).toEqual(["cpp"]);
});

test("finds a prompt through its collection name", () => {
  const lib = library([
    prompt({ id: "m", title: "Launch copy", collectionId: "c-marketing" }),
  ]);
  expect(run(lib, { query: "marketing" })).toEqual(["m"]);
});

// --- Scope and filters ------------------------------------------------------

test("a search inside Favorites cannot return a non-favorite", () => {
  const lib = library([
    prompt({ id: "fav", title: "German email", favorite: true }),
    prompt({ id: "plain", title: "German email" }),
  ]);
  expect(
    run(lib, { view: { kind: "favorites" }, query: "German email" })
  ).toEqual(["fav"]);
});

test("combines view scope, collection, tags and favourite with AND", () => {
  const base = {
    title: "Notes",
    collectionId: "c-work",
    tagIds: ["t-writing", "t-german"],
    content: "summarize the thread",
    favorite: true,
  };
  const filters = {
    collectionId: "c-work",
    tagIds: ["t-writing", "t-german"],
    favoriteOnly: true,
  };
  expect(
    run(library([prompt({ id: "hit", ...base })]), { filters, query: "summ" })
  ).toEqual(["hit"]);

  expect(
    run(library([prompt({ id: "hit", ...base, tagIds: ["t-writing"] })]), {
      filters,
      query: "summ",
    })
  ).toEqual([]);

  expect(
    run(
      library([prompt({ id: "hit", ...base, collectionId: "c-marketing" })]),
      {
        filters,
        query: "summ",
      }
    )
  ).toEqual([]);

  expect(
    run(library([prompt({ id: "hit", ...base, favorite: false })]), {
      filters,
      query: "summ",
    })
  ).toEqual([]);
});

test("a collection filter uses identity, not the collection name text", () => {
  const lib = library([
    prompt({ id: "named", title: "Marketing tips", collectionId: "c-work" }),
  ]);
  expect(
    run(lib, { filters: { collectionId: "c-marketing" }, query: "marketing" })
  ).toEqual([]);
});

test("archived prompts are excluded from every active view", () => {
  const lib = library([
    prompt({
      id: "archived",
      title: "German email",
      favorite: true,
      archived: true,
      collectionId: "c-german",
      lastUsedAt: 5 * DAY,
    }),
  ]);
  expect(run(lib, { query: "German email" })).toEqual([]);
  expect(
    run(lib, { view: { kind: "favorites" }, query: "German email" })
  ).toEqual([]);
  expect(run(lib, { view: { kind: "recents" } })).toEqual([]);
  expect(
    run(lib, { view: { kind: "collection", collectionId: "c-german" } })
  ).toEqual([]);
  expect(
    run(lib, { view: { kind: "archive" }, query: "German email" })
  ).toEqual(["archived"]);
});

test("Recents holds only active prompts that have been used", () => {
  const lib = library([
    prompt({ id: "old", title: "Old", lastUsedAt: 1 * DAY }),
    prompt({ id: "new", title: "New", lastUsedAt: 3 * DAY }),
    prompt({ id: "never", title: "Never" }),
  ]);
  expect(
    run(lib, { view: { kind: "recents" }, sort: "recently-used" })
  ).toEqual(["new", "old"]);
});

// --- Sorting ----------------------------------------------------------------

test("breaks relevance ties by use, modification, title, then identity", () => {
  const lib = library([
    prompt({ id: "zebra", title: "Zebra email" }),
    prompt({ id: "alpha", title: "Alpha email" }),
  ]);
  expect(run(lib, { query: "email" })).toEqual(["alpha", "zebra"]);

  const used = library([
    prompt({ id: "zebra", title: "Zebra email", lastUsedAt: 9 * DAY }),
    prompt({ id: "alpha", title: "Alpha email" }),
  ]);
  expect(run(used, { query: "email" })).toEqual(["zebra", "alpha"]);
});

test("an explicit sort overrides relevance without broadening eligibility", () => {
  const lib = library([
    prompt({ id: "exact", title: "German email", createdAt: 1 * DAY }),
    prompt({
      id: "body",
      title: "Unrelated",
      content: "german email",
      createdAt: 9 * DAY,
    }),
    prompt({ id: "other", title: "Nothing", createdAt: 20 * DAY }),
  ]);
  expect(run(lib, { query: "German email" })).toEqual(["exact", "body"]);
  expect(run(lib, { query: "German email", sort: "newest" })).toEqual([
    "body",
    "exact",
  ]);
  expect(run(lib, { query: "German email", sort: "oldest" })).toEqual([
    "exact",
    "body",
  ]);
});

test("Recently used puts never-used prompts last, ordered by modification", () => {
  const lib = library([
    prompt({ id: "used-old", title: "A", lastUsedAt: 1 * DAY }),
    prompt({ id: "used-new", title: "B", lastUsedAt: 4 * DAY }),
    prompt({ id: "fresh", title: "C", modifiedAt: 30 * DAY }),
    prompt({ id: "stale", title: "D", modifiedAt: 2 * DAY }),
  ]);
  expect(run(lib, { sort: "recently-used" })).toEqual([
    "used-new",
    "used-old",
    "fresh",
    "stale",
  ]);
});

test("Recently modified, Newest, Oldest and Title A-Z are deterministic", () => {
  const lib = library([
    prompt({ id: "b", title: "Beta", createdAt: 2 * DAY, modifiedAt: 5 * DAY }),
    prompt({
      id: "a",
      title: "Alpha",
      createdAt: 7 * DAY,
      modifiedAt: 5 * DAY,
    }),
    prompt({
      id: "c",
      title: "Gamma",
      createdAt: 1 * DAY,
      modifiedAt: 9 * DAY,
    }),
  ]);
  expect(run(lib, { sort: "recently-modified" })).toEqual(["c", "a", "b"]);
  expect(run(lib, { sort: "newest" })).toEqual(["a", "b", "c"]);
  expect(run(lib, { sort: "oldest" })).toEqual(["c", "b", "a"]);
  expect(run(lib, { sort: "title" })).toEqual(["a", "b", "c"]);
});

test("a blank query imposes no text restriction", () => {
  const lib = library([
    prompt({ id: "a", title: "Alpha" }),
    prompt({ id: "b", title: "Beta" }),
  ]);
  expect(run(lib, { query: "   ", sort: "title" })).toEqual(["a", "b"]);
});
