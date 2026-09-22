"use client";
import { organizationSearch } from "@pr0/api-contract/organization";
import { promptQuerySchema, promptSortSchema } from "@pr0/api-contract/prompts";
import type { PromptSort } from "@pr0/api-contract/prompts";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useEffect, useState, useSyncExternalStore } from "react";

const subscribeSort = (changed: () => void) => {
  window.addEventListener("storage", changed);
  window.addEventListener("pr0:browse-sort", changed);
  return () => {
    window.removeEventListener("storage", changed);
    window.removeEventListener("pr0:browse-sort", changed);
  };
};
const readSort = (scope: string, defaultSort: PromptSort): PromptSort => {
  try {
    const saved = promptSortSchema.safeParse(
      localStorage.getItem(`pr0:browse-sort:${scope}`)
    );
    return saved.success && saved.data !== "relevance"
      ? saved.data
      : defaultSort;
  } catch {
    return defaultSort;
  }
};

export const usePromptSearch = (
  scope: string,
  defaultSort: PromptSort = "recently-modified"
) => {
  const t = useTranslations();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const browseSort = useSyncExternalStore(
    subscribeSort,
    () => readSort(scope, defaultSort),
    (): PromptSort => defaultSort
  );
  const [searchSort, setSearchSort] = useState<PromptSort>("relevance");
  const validation = promptQuerySchema.safeParse(query);
  const searching =
    Boolean(query) &&
    (!validation.success || Boolean(organizationSearch(query)));
  const error = validation.success
    ? ""
    : (validation.error.issues[0]?.message ?? t("invalidSearchText"));
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 35);
    return () => clearTimeout(timer);
  }, [query]);
  const changeQuery = (value: string) => {
    if (!searching) {
      setSearchSort("relevance");
    }
    setQuery(value);
  };
  return {
    query,
    debounced,
    error,
    searching,
    pending: query !== debounced,
    sort: searching ? searchSort : browseSort,
    changeQuery,
    clear: () => {
      setQuery("");
      setDebounced("");
      setSearchSort("relevance");
    },
    changeSort: (sort: PromptSort) => {
      if (searching) {
        setSearchSort(sort);
      } else {
        try {
          localStorage.setItem(`pr0:browse-sort:${scope}`, sort);
          window.dispatchEvent(new Event("pr0:browse-sort"));
        } catch {
          /* Browsing still works when local storage is unavailable. */
        }
      }
    },
  };
};
