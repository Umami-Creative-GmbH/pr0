import type {
  DesktopSearch,
  DesktopSearchPage,
} from "@pr0/api-contract/desktop-search";
import { organizationSearch } from "@pr0/api-contract/organization";
import { promptQuerySchema, promptSortSchema } from "@pr0/api-contract/prompts";
import type { PromptSort, PromptView } from "@pr0/api-contract/prompts";
import { useEffect, useRef, useState } from "react";

import { downloadError, libraryClient } from "./library-client";
import type { Status } from "./use-auth-session";

const remembered = (key: string, view: PromptView): PromptSort => {
  try {
    const parsed = promptSortSchema.safeParse(localStorage.getItem(key));
    if (parsed.success && parsed.data !== "relevance") {
      return parsed.data;
    }
  } catch {
    /* Storage is optional; retrieval stays available. */
  }
  return view === "recents" ? "recently-used" : "recently-modified";
};
export const useLocalSearch = (
  account: Status,
  refresh: number,
  onSelect: (id: string | null) => Promise<void>
) => {
  const [view, setView] = useState<PromptView>("all");
  const [viewCollectionId, setViewCollectionId] = useState<string>();
  const [query, setQuery] = useState("");
  const [collectionId, setCollectionId] = useState<string>();
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [searchSort, setSearchSort] = useState<PromptSort>("relevance");
  const key = `pr0:desktop-sort:${account.instanceId}:${account.accountId}:${viewCollectionId ?? view}`;
  const [browseSort, setBrowseSort] = useState<PromptSort>(() =>
    remembered(key, "all")
  );
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<DesktopSearchPage>();
  const [errorText, setErrorText] = useState("");
  const [recoveryNeeded, setRecoveryNeeded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const selected = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const request = useRef<DesktopSearch | null>(null);
  const validQuery = promptQuerySchema.safeParse(query);
  const searching =
    Boolean(query) &&
    (!validQuery.success || Boolean(organizationSearch(query)));
  const sort = searching ? searchSort : browseSort;
  const cursor = cursors.at(-1);
  // oxlint-disable react/exhaustive-effect-dependencies -- Native refresh/retry tokens deliberately rerun the query without changing its input.
  useEffect(() => {
    void refresh;
    void retry;
    const abort = new AbortController();
    const input: DesktopSearch = {
      instanceId: account.instanceId ?? "",
      accountId: account.accountId ?? "",
      generation: account.generation,
      requestId: crypto.randomUUID(),
      query,
      view,
      sort,
      collectionId,
      viewCollectionId,
      tagIds,
      favorite: favorite || undefined,
      limit: 50,
      cursor,
      selectedId: selected.current ?? undefined,
    };
    request.current = input;
    const run = async () => {
      setBusy(true);
      setErrorText("");
      setRecoveryNeeded(false);
      const validation = promptQuerySchema.safeParse(input.query);
      if (!validation.success) {
        setErrorText(validation.error.issues[0]?.message ?? "Invalid query.");
        setPage(undefined);
        setBusy(false);
        selected.current = null;
        setSelectedId(null);
        await onSelect(null);
        return;
      }
      try {
        const result = await libraryClient.search(input, abort.signal);
        if (abort.signal.aborted) {
          return;
        }
        setPage(result);
        selected.current = result.selectedId;
        setSelectedId(result.selectedId);
        await onSelect(result.selectedId);
      } catch (error) {
        if (abort.signal.aborted) {
          return;
        }
        if (error === "results_changed") {
          setCursors([]);
          return;
        }
        if (error === "search_busy") {
          setTimeout(() => {
            if (!abort.signal.aborted) {
              setRetry((value) => value + 1);
            }
          }, 25);
          return;
        }
        setErrorText(downloadError(error));
        setRecoveryNeeded(error === "search_recovery_required");
        setPage(undefined);
        selected.current = null;
        setSelectedId(null);
        await onSelect(null);
      }
      if (!abort.signal.aborted) {
        setBusy(false);
      }
    };
    const timer = setTimeout(() => {
      void run();
    }, 20);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [
    account.instanceId,
    account.accountId,
    account.generation,
    query,
    view,
    sort,
    collectionId,
    viewCollectionId,
    tagIds,
    favorite,
    cursor,
    refresh,
    retry,
    onSelect,
  ]);
  // oxlint-enable react/exhaustive-effect-dependencies
  const resetPage = () => {
    setCursors([]);
    setBusy(true);
  };
  const clearFilters = () => {
    setCollectionId(undefined);
    setTagIds([]);
    setFavorite(false);
    resetPage();
  };
  return {
    page,
    busy,
    error: errorText,
    recoveryNeeded,
    view,
    viewCollectionId,
    query,
    collectionId,
    tagIds,
    favorite,
    sort,
    searching,
    offset: cursors.length * 50,
    restricted:
      searching || Boolean(collectionId) || tagIds.length > 0 || favorite,
    selectedId,
    select: async (id: string) => {
      selected.current = id;
      setSelectedId(id);
      await onSelect(id);
    },
    changeQuery: (value: string) => {
      if (!searching) {
        setSearchSort("relevance");
      }
      setQuery(value);
      resetPage();
    },
    changeCollection: (id: string) => {
      setCollectionId(id || undefined);
      resetPage();
    },
    changeTags: (ids: string[]) => {
      setTagIds(ids);
      resetPage();
    },
    changeFavorite: (value: boolean) => {
      setFavorite(value);
      resetPage();
    },
    changeSort: (value: PromptSort) => {
      if (searching) {
        setSearchSort(value);
      } else {
        setBrowseSort(value);
        try {
          localStorage.setItem(key, value);
        } catch {
          /* Keep the in-memory preference. */
        }
      }
      resetPage();
    },
    navigate: (next: PromptView, id?: string) => {
      if (next === view && id === viewCollectionId) {
        return;
      }
      setView(next);
      setViewCollectionId(id);
      setQuery("");
      setSearchSort("relevance");
      clearFilters();
      setBrowseSort(
        remembered(
          `pr0:desktop-sort:${account.instanceId}:${account.accountId}:${id ?? next}`,
          next
        )
      );
    },
    clearFilters,
    previous: () => {
      setCursors((values) => values.slice(0, -1));
      setBusy(true);
    },
    next: () => {
      const next = page?.nextCursor;
      if (next) {
        setCursors((values) => [...values, next]);
        setBusy(true);
      }
    },
    recover: async () => {
      if (!request.current) {
        return;
      }
      setBusy(true);
      setErrorText("Preparing search…");
      try {
        await libraryClient.recoverSearch(request.current);
        setRetry((value) => value + 1);
      } catch (error) {
        setErrorText(downloadError(error));
        setPage(undefined);
        setBusy(false);
      }
    },
  };
};
