"use client";
import { promptSortSchema } from "@pr0/api-contract/prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { SearchBox } from "@pr0/ui/components/search-box";
import { useTranslations } from "@pr0/ui/hooks/use-translations";

import type { usePromptSearch } from "./use-prompt-search";

type Search = ReturnType<typeof usePromptSearch>;

export const PromptSearchControls = ({ search }: { search: Search }) => {
  const t = useTranslations();
  return (
    <search aria-label={t("findPrompts")} className="flex flex-col gap-2">
      <SearchBox
        id="prompt-search"
        data-library-search
        aria-label={t("searchPrompts")}
        aria-describedby={search.error ? "search-error" : "search-help"}
        hint="/"
        invalid={Boolean(search.error)}
        placeholder={t("searchPrompts2")}
        value={search.query}
        onChange={(event) => search.changeQuery(event.target.value)}
      />
      <p id="search-help" className="sr-only">
        {t("findLiteralTextInTitlesContentDescriptionsTagsAndCollections")}
      </p>
      {search.error ? (
        <p id="search-error" className="wf-error" role="alert">
          <LocalizedMessage value={search.error} />
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
              {t("clearSearch")}
            </button>
          ) : null}
          {search.pending ? (
            <output className="wf-hint">{t("updatingSearch")}</output>
          ) : null}
        </div>
      ) : null}
    </search>
  );
};

export const PromptSortControl = ({ search }: { search: Search }) => {
  const t = useTranslations();
  return (
    <select
      id="prompt-sort"
      aria-label={t("sortPrompts")}
      value={search.sort}
      onChange={(event) =>
        search.changeSort(promptSortSchema.parse(event.target.value))
      }
    >
      {search.searching ? (
        <option value="relevance">{t("relevance")}</option>
      ) : null}
      <option value="recently-modified">{t("recentlyModified")}</option>
      <option value="recently-used">{t("recentlyUsed")}</option>
      <option value="newest">{t("newest")}</option>
      <option value="oldest">{t("oldest")}</option>
      <option value="title">{t("titleAZ")}</option>
    </select>
  );
};
