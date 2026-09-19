/**
 * PROTOTYPE (issue #9) — views, search, filters, sort and the result list.
 *
 * The empty states are deliberately differentiated per issue #7: a genuinely
 * empty library offers creation, an unfiltered Recents explains itself, and a
 * restricted no-match state keeps the query and filters with separate
 * clearing actions.
 */

import { useTranslate } from "@tolgee/react";
import { Inbox, Plus, RotateCcw, Search, SearchX, Star, X } from "lucide-react";
import type { RefObject } from "react";

import type {
  Filters,
  Library,
  Prompt,
  PromptId,
  Sort,
  View,
} from "../domain/types";
import { hasActiveFilters } from "../store/library-store";
import { formatRelative } from "./formatting";

const VIEWS: { view: View; key: string }[] = [
  { view: { kind: "all" }, key: "view.all" },
  { view: { kind: "favorites" }, key: "view.favorites" },
  { view: { kind: "recents" }, key: "view.recents" },
  { view: { kind: "archive" }, key: "view.archive" },
];

const SORTS: { sort: Sort; key: string }[] = [
  { sort: "relevance", key: "sort.relevance" },
  { sort: "recently-used", key: "sort.recentlyUsed" },
  { sort: "recently-modified", key: "sort.recentlyModified" },
  { sort: "newest", key: "sort.newest" },
  { sort: "oldest", key: "sort.oldest" },
  { sort: "title", key: "sort.title" },
];

export interface LibrarySidebarProps {
  library: Library;
  results: Prompt[];
  view: View;
  query: string;
  filters: Filters;
  sort: Sort;
  selectedId: PromptId | null;
  locale: string;
  now: number;
  searchRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
  onViewChange: (view: View) => void;
  onQueryChange: (query: string) => void;
  onClearQuery: () => void;
  onClearFilters: () => void;
  onSortChange: (sort: Sort) => void;
  onResetSort: () => void;
  /** True when the sort is this view's default, so reset is hidden. */
  sortIsDefault: boolean;
  onCollectionFilter: (collectionId: string | null) => void;
  onTagFilter: (tagId: string) => void;
  onFavoriteFilter: () => void;
  onSelect: (id: PromptId) => void;
  onToggleFavorite: (id: PromptId) => void;
  onNew: () => void;
}

const EmptyState = ({
  library,
  view,
  query,
  filters,
  onClearQuery,
  onClearFilters,
  onNew,
}: Pick<
  LibrarySidebarProps,
  | "library"
  | "view"
  | "query"
  | "filters"
  | "onClearQuery"
  | "onClearFilters"
  | "onNew"
>) => {
  const { t } = useTranslate();
  const restricted = query.trim() !== "" || hasActiveFilters(filters);

  if (restricted) {
    return (
      <div className="pr0-empty">
        <SearchX aria-hidden="true" size={28} />
        <h3>{t("empty.noMatch.title")}</h3>
        <p>{t("empty.noMatch.body")}</p>
        <div className="pr0-empty-actions">
          {query.trim() === "" ? null : (
            <button className="pr0-pill" onClick={onClearQuery} type="button">
              <X aria-hidden="true" size={13} />
              {t("search.clear")}
            </button>
          )}
          {hasActiveFilters(filters) ? (
            <button className="pr0-pill" onClick={onClearFilters} type="button">
              <X aria-hidden="true" size={13} />
              {t("filters.clear")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (view.kind === "recents") {
    return (
      <div className="pr0-empty">
        <Inbox aria-hidden="true" size={28} />
        <h3>{t("empty.recents.title")}</h3>
        <p>{t("empty.recents.body")}</p>
      </div>
    );
  }

  if (view.kind === "archive") {
    return (
      <div className="pr0-empty">
        <Inbox aria-hidden="true" size={28} />
        <h3>{t("empty.archive.title")}</h3>
        <p>{t("empty.archive.body")}</p>
      </div>
    );
  }

  if (view.kind === "favorites") {
    return (
      <div className="pr0-empty">
        <Star aria-hidden="true" size={28} />
        <h3>{t("empty.favorites.title")}</h3>
        <p>{t("empty.favorites.body")}</p>
      </div>
    );
  }

  // All prompts with nothing to show: a genuinely empty library.
  const empty = library.prompts.length === 0;
  return (
    <div className="pr0-empty">
      <Inbox aria-hidden="true" size={28} />
      <h3>{empty ? t("empty.library.title") : t("empty.noMatch.title")}</h3>
      <p>{empty ? t("empty.library.body") : t("empty.noMatch.body")}</p>
      <button className="pr0-pill" onClick={onNew} type="button">
        <Plus aria-hidden="true" size={14} />
        {t("empty.library.action")}
      </button>
    </div>
  );
};

export const LibrarySidebar = (props: LibrarySidebarProps) => {
  const { t } = useTranslate();
  const {
    library,
    results,
    view,
    query,
    filters,
    sort,
    selectedId,
    locale,
    now,
    searchRef,
    listRef,
    onViewChange,
    onQueryChange,
    onClearQuery,
    onSortChange,
    onResetSort,
    sortIsDefault,
    onCollectionFilter,
    onTagFilter,
    onFavoriteFilter,
    onSelect,
    onToggleFavorite,
    onNew,
  } = props;

  const searching = query.trim() !== "";
  // Tag chips stay legible: only tags in play for the current view.
  const tagsInUse = new Set(library.prompts.flatMap((prompt) => prompt.tagIds));
  const visibleTags = library.tags.filter((tag) => tagsInUse.has(tag.id));
  const activeTagFilters = new Set(filters.tagIds);

  return (
    <div className="pr0-sidebar">
      <div className="pr0-sidebar-head">
        <div className="pr0-searchbox">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label={t("search.placeholder")}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("search.placeholder")}
            ref={searchRef}
            value={query}
          />
          {searching ? (
            <button
              aria-label={t("search.clear")}
              className="pr0-star"
              onClick={onClearQuery}
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          ) : (
            <span className="pr0-kbd">/</span>
          )}
        </div>

        <div className="pr0-views">
          {VIEWS.map((entry) => (
            <button
              className="pr0-pill"
              data-active={view.kind === entry.view.kind}
              key={entry.key}
              onClick={() => onViewChange(entry.view)}
              type="button"
            >
              {t(entry.key)}
            </button>
          ))}
        </div>
      </div>

      <div className="pr0-facet">
        <span className="pr0-eyebrow">{t("collections.heading")}</span>
        <div className="pr0-chips">
          <button
            aria-pressed={filters.collectionId === null}
            className="pr0-chip"
            onClick={() => onCollectionFilter(null)}
            type="button"
          >
            <span
              className="pr0-dot"
              style={{ background: "var(--app-line-strong)" }}
            />
            {t("collections.all")}
          </button>
          {library.collections.map((collection) => (
            <button
              aria-pressed={filters.collectionId === collection.id}
              className="pr0-chip"
              key={collection.id}
              onClick={() =>
                onCollectionFilter(
                  filters.collectionId === collection.id ? null : collection.id
                )
              }
              type="button"
            >
              <span
                className="pr0-dot"
                style={{ background: collection.accent }}
              />
              {collection.name}
            </button>
          ))}
          <button
            aria-pressed={filters.favoriteOnly}
            className="pr0-chip"
            onClick={onFavoriteFilter}
            type="button"
          >
            <Star aria-hidden="true" size={12} />
            {t("filters.favoriteOnly")}
          </button>
        </div>
      </div>

      <div className="pr0-facet">
        <span className="pr0-eyebrow">{t("tags.heading")}</span>
        <div className="pr0-chips">
          {visibleTags.map((tag) => (
            <button
              aria-pressed={activeTagFilters.has(tag.id)}
              className="pr0-chip"
              key={tag.id}
              onClick={() => onTagFilter(tag.id)}
              type="button"
            >
              {`#${tag.name}`}
            </button>
          ))}
        </div>
      </div>

      <div className="pr0-listhead">
        <span className="pr0-eyebrow">
          {t("list.count", { count: results.length })}
        </span>
        <span className="pr0-spacer" />
        <label className="pr0-visually-hidden" htmlFor="pr0-sort">
          {t("sort.heading")}
        </label>
        <select
          className="pr0-sortselect"
          id="pr0-sort"
          onChange={(event) => {
            // SAFETY: the option values are rendered from SORTS, so the
            // selected value is always one of the Sort literals.
            onSortChange(event.target.value as Sort);
          }}
          value={sort}
        >
          {SORTS.filter((entry) => entry.sort !== "relevance" || searching).map(
            (entry) => (
              <option key={entry.sort} value={entry.sort}>
                {t(entry.key)}
              </option>
            )
          )}
        </select>
        {sortIsDefault ? null : (
          <button className="pr0-chip" onClick={onResetSort} type="button">
            <RotateCcw aria-hidden="true" size={12} />
            {t("sort.reset")}
          </button>
        )}
        <button className="pr0-pill" onClick={onNew} type="button">
          <Plus aria-hidden="true" size={13} />
          {t("list.new")}
        </button>
      </div>

      <ul className="pr0-list" ref={listRef}>
        {results.map((prompt) => {
          const collection = library.collections.find(
            (candidate) => candidate.id === prompt.collectionId
          );
          return (
            <li key={prompt.id}>
              <button
                aria-current={prompt.id === selectedId}
                className="pr0-row"
                onClick={() => onSelect(prompt.id)}
                type="button"
              >
                <span className="pr0-row-top">
                  <span className="pr0-row-title">{prompt.title}</span>
                  <span
                    aria-hidden="true"
                    className="pr0-star"
                    data-on={prompt.favorite}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite(prompt.id);
                    }}
                  >
                    <Star
                      fill={prompt.favorite ? "currentColor" : "none"}
                      size={14}
                    />
                  </span>
                </span>

                <span className="pr0-row-preview">
                  {prompt.content.replaceAll(/\s+/gu, " ").slice(0, 120)}
                </span>

                <span className="pr0-row-meta">
                  <span className="pr0-collection">
                    <span
                      className="pr0-dot"
                      style={{
                        background:
                          collection?.accent ?? "var(--app-line-strong)",
                      }}
                    />
                    {collection?.name ?? t("detail.unassigned")}
                  </span>
                  <span className="pr0-mono">
                    {prompt.tagIds
                      .map((tagId) => {
                        const tag = library.tags.find(
                          (candidate) => candidate.id === tagId
                        );
                        return `#${tag?.name ?? tagId}`;
                      })
                      .join(" ")}
                  </span>
                  <span className="pr0-spacer" />
                  <span>{formatRelative(prompt.modifiedAt, now, locale)}</span>
                </span>
              </button>
            </li>
          );
        })}

        {results.length === 0 ? (
          <li>
            <EmptyState {...props} />
          </li>
        ) : null}
      </ul>
    </div>
  );
};
