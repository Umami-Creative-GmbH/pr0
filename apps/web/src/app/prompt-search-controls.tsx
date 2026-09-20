"use client";

import { promptSortSchema } from "@pr0/api-contract/prompts";

import type { usePromptSearch } from "./use-prompt-search";

export const PromptSearchControls = ({
  search,
}: {
  search: ReturnType<typeof usePromptSearch>;
}) => (
  <search className="flex flex-wrap items-end gap-3" aria-label="Find prompts">
    <div className="min-w-64 flex-1">
      <label htmlFor="prompt-search" className="block font-medium">
        Search prompts
      </label>
      <input
        id="prompt-search"
        type="search"
        value={search.query}
        className="bg-background w-full rounded-md border px-3 py-2"
        aria-describedby={search.error ? "search-error" : "search-help"}
        aria-invalid={Boolean(search.error)}
        onChange={(event) => search.changeQuery(event.target.value)}
      />
      <p id="search-help" className="text-muted-foreground text-sm">
        Find literal text in titles, descriptions and content.
      </p>
      {search.error ? (
        <p id="search-error" role="alert">
          {search.error}
        </p>
      ) : null}
    </div>
    <div>
      <label htmlFor="prompt-sort" className="block font-medium">
        Sort prompts
      </label>
      <select
        id="prompt-sort"
        className="bg-background rounded-md border px-3 py-2"
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
    </div>
    {search.query ? (
      <button
        type="button"
        className="rounded-md border px-4 py-2"
        onClick={() => search.clear()}
      >
        Clear search
      </button>
    ) : null}
    {search.pending ? <output>Updating search…</output> : null}
  </search>
);
