/**
 * PROTOTYPE (issue #9) — the launcher's result list and its empty states.
 *
 * Issue #7 wants the empty state differentiated: a filter-only exclusion must
 * not claim the query found nothing, and the restrictions stay visible with
 * separate actions to clear each one.
 */

import { useTranslate } from "@tolgee/react";

import type { Library, Prompt, PromptId } from "../domain/types";

export interface LauncherResultsProps {
  library: Library;
  results: Prompt[];
  activeId: PromptId | null;
  emptyMessage: string;
  /** True when a query or any filter is narrowing the list. */
  hasRestrictions: boolean;
  queryActive: boolean;
  filtersActive: boolean;
  onHover: (promptId: PromptId) => void;
  onRun: (promptId: PromptId) => void;
  onClearQuery: () => void;
  onClearFilters: () => void;
}

export const LauncherResults = ({
  library,
  results,
  activeId,
  emptyMessage,
  hasRestrictions,
  queryActive,
  filtersActive,
  onHover,
  onRun,
  onClearQuery,
  onClearFilters,
}: LauncherResultsProps) => {
  const { t } = useTranslate();

  const collectionOf = (prompt: Prompt) =>
    library.collections.find(
      (candidate) => candidate.id === prompt.collectionId
    );

  return (
    <ul
      aria-label={t("launcher.placeholder")}
      className="pr0-launcher-list"
      role="listbox"
    >
      {results.map((prompt) => {
        const collection = collectionOf(prompt);
        return (
          <li key={prompt.id} role="presentation">
            <button
              aria-selected={prompt.id === activeId}
              className="pr0-launcher-row"
              onClick={() => onRun(prompt.id)}
              onMouseEnter={() => onHover(prompt.id)}
              role="option"
              type="button"
            >
              <span
                className="pr0-dot"
                style={{
                  background: collection?.accent ?? "var(--app-line-strong)",
                }}
              />
              <span className="pr0-title">{prompt.title}</span>
              <span className="pr0-collection">
                {collection?.name ?? t("detail.unassigned")}
              </span>
              <span
                className="pr0-mono"
                style={{
                  color:
                    prompt.id === activeId ? "var(--pink-500)" : "transparent",
                }}
              >
                &#8629;
              </span>
            </button>
          </li>
        );
      })}

      {results.length === 0 ? (
        <li className="pr0-empty">
          <p>{emptyMessage}</p>
          {hasRestrictions ? (
            <span className="pr0-empty-actions">
              {queryActive ? (
                <button
                  className="pr0-chip"
                  onClick={onClearQuery}
                  type="button"
                >
                  {t("search.clear")}
                </button>
              ) : null}
              {filtersActive ? (
                <button
                  className="pr0-chip"
                  onClick={onClearFilters}
                  type="button"
                >
                  {t("filters.clear")}
                </button>
              ) : null}
            </span>
          ) : null}
        </li>
      ) : null}
    </ul>
  );
};
