"use client";

import { promptSortSchema } from "@pr0/api-contract/prompts";
import { SearchBox } from "@pr0/ui/components/search-box";

import type { usePromptSearch } from "./use-prompt-search";

type Search = ReturnType<typeof usePromptSearch>;

export const PromptSearchControls = ({ search }: { search: Search }) => (
  <search aria-label="Find prompts" className="flex flex-col gap-2">
    <SearchBox
      id="prompt-search"
      data-library-search
      aria-label="Search prompts"
      aria-describedby={search.error ? "search-error" : "search-help"}
      hint="/"
      invalid={Boolean(search.error)}
      placeholder="Search prompts…"
      value={search.query}
      onChange={(event) => search.changeQuery(event.target.value)}
    />
    <p id="search-help" className="sr-only">
      Find literal text in titles, content, descriptions, tags and collections.
    </p>
    {search.error ? (
      <p id="search-error" className="wf-error" role="alert">
        {search.error}
      </p>
    ) : null}
    {search.query || search.pending ? (
      <div className="flex items-center gap-2">
        {search.query ? (
          <button
            type="button"
            className="wf-btn-quiet"
            onClick={() => search.clear()}
          >
            Clear search
          </button>
        ) : null}
        {search.pending ? (
          <output className="wf-hint">Updating search…</output>
        ) : null}
      </div>
    ) : null}
  </search>
);

export const PromptSortControl = ({ search }: { search: Search }) => (
  <select
    id="prompt-sort"
    aria-label="Sort prompts"
    value={search.sort}
    onChange={(event) =>
      search.changeSort(promptSortSchema.parse(event.target.value))
    }
  >
    {search.searching ? <option value="relevance">Relevance</option> : null}
    <option value="recently-modified">Recently modified</option>
    <option value="recently-used">Recently used</option>
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="title">Title A–Z</option>
  </select>
);
