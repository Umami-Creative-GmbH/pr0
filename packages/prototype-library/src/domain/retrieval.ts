/**
 * PROTOTYPE (issue #9) — retrieval semantics agreed in issue #7.
 *
 * Scope, filters and the text query combine with AND. Relevance uses the
 * highest qualifying tier rather than cumulative boosts.
 */

import { normalize, queryTerms } from "./normalize";
import type {
  Library,
  Prompt,
  RelevanceTier,
  RetrievalRequest,
  Sort,
  View,
} from "./types";

interface Searchable {
  title: string;
  description: string;
  content: string;
  /** Tag names and the collection name share a relevance tier. */
  organization: string[];
}

const searchableOf = (prompt: Prompt, library: Library): Searchable => {
  const collection = library.collections.find(
    (candidate) => candidate.id === prompt.collectionId
  );
  const tagNames = prompt.tagIds.map((tagId) => {
    const tag = library.tags.find((candidate) => candidate.id === tagId);
    return normalize(tag?.name ?? "");
  });

  return {
    title: normalize(prompt.title),
    description: normalize(prompt.description),
    content: normalize(prompt.content),
    organization: collection
      ? [...tagNames, normalize(collection.name)]
      : tagNames,
  };
};

const inOrganization = (term: string, searchable: Searchable): boolean =>
  searchable.organization.some((name) => name.includes(term));

const anyFieldHas = (term: string, searchable: Searchable): boolean =>
  searchable.title.includes(term) ||
  searchable.description.includes(term) ||
  searchable.content.includes(term) ||
  inOrganization(term, searchable);

/**
 * Returns the relevance tier, or null when the prompt is not eligible because
 * some query term matches nowhere.
 */
export const relevanceTier = (
  prompt: Prompt,
  library: Library,
  terms: string[],
  normalizedQuery: string
): RelevanceTier | null => {
  const searchable = searchableOf(prompt, library);
  if (!terms.every((term) => anyFieldHas(term, searchable))) {
    return null;
  }

  if (searchable.title === normalizedQuery) {
    return 1;
  }
  if (terms.every((term) => searchable.title.includes(term))) {
    return 2;
  }
  if (terms.some((term) => searchable.title.includes(term))) {
    return 3;
  }
  if (terms.some((term) => inOrganization(term, searchable))) {
    return 4;
  }
  // oxlint-disable-next-line react-doctor/js-set-map-lookups -- String#includes, not Array#includes.
  if (terms.some((term) => searchable.description.includes(term))) {
    return 5;
  }
  return 6;
};

const inScope = (prompt: Prompt, view: View): boolean => {
  if (view.kind === "archive") {
    return prompt.archived;
  }
  if (prompt.archived) {
    return false;
  }
  if (view.kind === "favorites") {
    return prompt.favorite;
  }
  if (view.kind === "recents") {
    return prompt.lastUsedAt !== null;
  }
  if (view.kind === "collection") {
    return prompt.collectionId === view.collectionId;
  }
  return true;
};

const passesFilters = (
  prompt: Prompt,
  filters: RetrievalRequest["filters"]
): boolean => {
  if (filters.favoriteOnly && !prompt.favorite) {
    return false;
  }
  if (
    filters.collectionId !== null &&
    prompt.collectionId !== filters.collectionId
  ) {
    return false;
  }
  const promptTags = new Set(prompt.tagIds);
  return filters.tagIds.every((tagId) => promptTags.has(tagId));
};

/** Descending by value, with never-used sorting after used. */
const byOptionalDescending = (
  left: number | null,
  right: number | null
): number => {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right - left;
};

/**
 * Plain code-unit comparison of the normalized title, then identity.
 *
 * Deliberately not `localeCompare`: issue #7 requires "the same deterministic
 * normalized-title and identity comparison across surfaces" rather than
 * inheriting platform collation. The concrete shared comparator is #10's to
 * define; this is the prototype's stand-in.
 */
const compareStrings = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
};

const byTitleThenIdentity = (left: Prompt, right: Prompt): number =>
  compareStrings(normalize(left.title), normalize(right.title)) ||
  compareStrings(left.id, right.id);

/** Shared relevance tie-break: use, modification, title, identity. */
const byUseThenModification = (left: Prompt, right: Prompt): number =>
  byOptionalDescending(left.lastUsedAt, right.lastUsedAt) ||
  right.modifiedAt - left.modifiedAt ||
  byTitleThenIdentity(left, right);

/**
 * Issue #7: "Recently used puts never-used prompts last and orders that unused
 * group by modification date descending before title and identity." Modification
 * date is therefore a tie-break for the never-used group only; equally-used
 * prompts fall straight through to title and identity.
 */
const byRecentlyUsed = (left: Prompt, right: Prompt): number => {
  const used = byOptionalDescending(left.lastUsedAt, right.lastUsedAt);
  if (used !== 0) {
    return used;
  }
  const neverUsed = left.lastUsedAt === null && right.lastUsedAt === null;
  if (neverUsed) {
    return (
      right.modifiedAt - left.modifiedAt || byTitleThenIdentity(left, right)
    );
  }
  return byTitleThenIdentity(left, right);
};

const explicitComparators: Record<
  Exclude<Sort, "relevance">,
  (left: Prompt, right: Prompt) => number
> = {
  "recently-used": byRecentlyUsed,
  "recently-modified": (left, right) =>
    right.modifiedAt - left.modifiedAt || byTitleThenIdentity(left, right),
  newest: (left, right) =>
    right.createdAt - left.createdAt || byTitleThenIdentity(left, right),
  oldest: (left, right) =>
    left.createdAt - right.createdAt || byTitleThenIdentity(left, right),
  title: byTitleThenIdentity,
};

/**
 * Applies scope, filters, the text query and the requested sort.
 * Relevance falls back to Recently modified when the query is blank.
 */
export const retrieve = (request: RetrievalRequest): Prompt[] => {
  const { library, view, filters, query, sort } = request;
  const normalizedQuery = normalize(query);
  const terms = queryTerms(query);

  const eligible: { prompt: Prompt; tier: RelevanceTier }[] = [];
  for (const prompt of library.prompts) {
    if (!(inScope(prompt, view) && passesFilters(prompt, filters))) {
      continue;
    }
    if (terms.length === 0) {
      eligible.push({ prompt, tier: 6 });
      continue;
    }
    const tier = relevanceTier(prompt, library, terms, normalizedQuery);
    if (tier !== null) {
      eligible.push({ prompt, tier });
    }
  }

  if (sort !== "relevance") {
    const comparator = explicitComparators[sort];
    return eligible
      .map((entry) => entry.prompt)
      .sort((left, right) => comparator(left, right));
  }

  if (terms.length === 0) {
    const comparator = explicitComparators["recently-modified"];
    return eligible
      .map((entry) => entry.prompt)
      .sort((left, right) => comparator(left, right));
  }

  return eligible
    .sort(
      (left, right) =>
        left.tier - right.tier ||
        byUseThenModification(left.prompt, right.prompt)
    )
    .map((entry) => entry.prompt);
};
