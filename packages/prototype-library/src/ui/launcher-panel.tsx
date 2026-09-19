/**
 * PROTOTYPE (issue #9) — the quick launcher.
 *
 * Mounted two ways: as an overlay inside the library (web and desktop main
 * window) and as the entire surface of the native Tauri launcher window.
 *
 * Issue #7 rules exercised here:
 * - every opening starts with a cleared query and cleared filters;
 * - archived prompts never appear;
 * - it closes only after a *successful* clipboard write; on failure it keeps
 *   the query and selection, shows an error and offers a retry.
 */

import { useTranslate } from "@tolgee/react";
import { Search, Star, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { resolveSelection } from "../domain/copy";
import { retrieve } from "../domain/retrieval";
import type { CollectionId, Library, Prompt, PromptId } from "../domain/types";
import { emptyFilters } from "../domain/types";

export interface LauncherPanelProps {
  library: Library;
  /** Resolves when the copy succeeded; rejects to drive the failure state. */
  onCopy: (promptId: PromptId) => Promise<void>;
  onOpenPrompt?: (promptId: PromptId) => void;
  onClose: () => void;
  /** True when this is the standalone Tauri launcher window. */
  standalone?: boolean;
  footerNote?: string;
}

const MAX_RESULTS = 7;

export const LauncherPanel = ({
  library,
  onCopy,
  onOpenPrompt,
  onClose,
  standalone = false,
  footerNote,
}: LauncherPanelProps) => {
  const { t } = useTranslate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Launcher query and filters reset on every opening: this component is
  // mounted fresh each time, so local state is the reset.
  const [query, setQuery] = useState("");
  const [collectionId, setCollectionId] = useState<CollectionId | null>(null);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<PromptId | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const results: Prompt[] = useMemo(
    () =>
      retrieve({
        library,
        view: { kind: "all" },
        filters: { ...emptyFilters, collectionId, favoriteOnly },
        query,
        // Empty query: recently used first, then never-used by modification.
        sort: query.trim() === "" ? "recently-used" : "relevance",
      }).slice(0, MAX_RESULTS),
    [library, query, collectionId, favoriteOnly]
  );

  // Selection follows identity while eligible, else the first result.
  // Derived during render, so results changing under the cursor cannot leave
  // a stale selection behind.
  const activeId = resolveSelection(selectedId, results);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const move = (delta: number) => {
    if (results.length === 0) {
      return;
    }
    const current = results.findIndex((prompt) => prompt.id === activeId);
    const from = current === -1 ? 0 : current;
    const next = (from + delta + results.length) % results.length;
    setSelectedId(results[next]?.id ?? null);
  };

  const copySelected = async () => {
    if (activeId === null || busy) {
      return;
    }
    setBusy(true);
    try {
      await onCopy(activeId);
      setCopyError(null);
      setBusy(false);
      onClose();
    } catch (error) {
      // Stays open, keeps query and selection, records no usage.
      setCopyError(error instanceof Error ? error.message : "clipboard-failed");
      setBusy(false);
    }
  };

  // Bound to the window, not to the panel: clicking a non-focusable part of
  // the launcher (the empty state, padding) must not disable the keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if ((event.metaKey || event.ctrlKey) && activeId !== null) {
          onOpenPrompt?.(activeId);
          onClose();
          return;
        }
        void copySelected();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const collectionOf = (prompt: Prompt) =>
    library.collections.find(
      (candidate) => candidate.id === prompt.collectionId
    );

  const activeCount = library.prompts.filter(
    (prompt) => !prompt.archived
  ).length;

  return (
    <div className="pr0-launcher" data-standalone={standalone}>
      <div className="pr0-launcher-head">
        <Search aria-hidden="true" size={18} />
        <input
          aria-label={t("launcher.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("launcher.placeholder")}
          ref={inputRef}
          value={query}
        />
        <span className="pr0-kbd">{t("launcher.hint.close")}</span>
      </div>

      <div className="pr0-launcher-filters">
        <button
          aria-pressed={favoriteOnly}
          className="pr0-chip"
          onClick={() => setFavoriteOnly((on) => !on)}
          type="button"
        >
          <Star aria-hidden="true" size={12} />
          {t("filters.favoriteOnly")}
        </button>
        {library.collections.map((collection) => (
          <button
            aria-pressed={collectionId === collection.id}
            className="pr0-chip"
            key={collection.id}
            onClick={() =>
              setCollectionId((current) =>
                current === collection.id ? null : collection.id
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
      </div>

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
                onClick={() => {
                  setSelectedId(prompt.id);
                  void copySelected();
                }}
                onMouseEnter={() => setSelectedId(prompt.id)}
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
                      prompt.id === activeId
                        ? "var(--pink-500)"
                        : "transparent",
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
            <p>
              {activeCount === 0
                ? t("launcher.emptyLibrary")
                : t("launcher.empty", { query })}
            </p>
          </li>
        ) : null}
      </ul>

      {copyError === null ? null : (
        <div className="pr0-launcher-error" role="alert">
          <TriangleAlert aria-hidden="true" size={16} />
          <span>{t("launcher.error", { message: copyError })}</span>
          <span className="pr0-spacer" />
          <button
            className="pr0-chip"
            disabled={busy}
            onClick={() => {
              void copySelected();
            }}
            type="button"
          >
            {t("launcher.retry")}
          </button>
        </div>
      )}

      <div className="pr0-launcher-foot">
        <span>{t("launcher.hint.navigate")}</span>
        <span>{t("launcher.hint.copy")}</span>
        <span>{t("launcher.hint.open")}</span>
        <span className="pr0-spacer" />
        <span>
          {footerNote ??
            t("launcher.count", {
              shown: results.length,
              total: activeCount,
            })}
        </span>
      </div>
    </div>
  );
};
