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
 *
 * A prompt with `{{variables}}` cannot be written to the clipboard until it
 * has values, so the launcher asks for them *in place* rather than handing
 * off to another surface. That keeps close-on-success literally true on both
 * surfaces — the answer agreed with the developer on issue #9.
 */

import { useTranslate } from "@tolgee/react";
import { Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { resolveSelection } from "../domain/copy";
import { retrieve } from "../domain/retrieval";
import type {
  CollectionId,
  Library,
  Prompt,
  PromptId,
  TagId,
} from "../domain/types";
import { emptyFilters } from "../domain/types";
import { extractVariables } from "../domain/variables";
import { VariablesDialog } from "./dialogs";
import { LauncherFilters } from "./launcher-filters";
import { LauncherResults } from "./launcher-results";

export interface LauncherPanelProps {
  library: Library;
  /**
   * Writes the prompt to the clipboard and records the use. Rejects to drive
   * the failure state: the launcher then stays open with its query and
   * selection, shows the error and offers a retry.
   */
  onCopy: (
    promptId: PromptId,
    variableValues?: Record<string, string>
  ) => Promise<void>;
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
  const [tagIds, setTagIds] = useState<TagId[]>([]);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<PromptId | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set while the launcher is asking for this prompt's variable values.
  const [variablesFor, setVariablesFor] = useState<Prompt | null>(null);

  const results: Prompt[] = useMemo(
    () =>
      retrieve({
        library,
        view: { kind: "all" },
        filters: { ...emptyFilters, collectionId, tagIds, favoriteOnly },
        query,
        // Empty query: recently used first, then never-used by modification.
        sort: query.trim() === "" ? "recently-used" : "relevance",
      }).slice(0, MAX_RESULTS),
    [library, query, collectionId, tagIds, favoriteOnly]
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

  const write = async (
    promptId: PromptId,
    variableValues?: Record<string, string>
  ) => {
    setBusy(true);
    try {
      await onCopy(promptId, variableValues);
      setCopyError(null);
      setBusy(false);
      onClose();
    } catch (error) {
      // Stays open, keeps query and selection, records no usage.
      setCopyError(error instanceof Error ? error.message : "clipboard-failed");
      setBusy(false);
    }
  };

  const copySelected = async () => {
    if (activeId === null || busy) {
      return;
    }
    const prompt = results.find((candidate) => candidate.id === activeId);
    if (prompt && extractVariables(prompt.content).length > 0) {
      // Ask here; the write happens once the values are in.
      setVariablesFor(prompt);
      return;
    }
    await write(activeId);
  };

  // Bound to the window, not to the panel: clicking a non-focusable part of
  // the launcher (the empty state, padding) must not disable the keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (variablesFor === null) {
          onClose();
        } else {
          // Back to the results rather than losing the query entirely.
          setVariablesFor(null);
        }
        return;
      }
      if (variablesFor !== null) {
        // The value form owns the keyboard while it is up.
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

  const activeCount = library.prompts.filter(
    (prompt) => !prompt.archived
  ).length;

  const activeTags = new Set(tagIds);
  // Only tags that are actually in play, so the row stays compact.
  const tagsInUse = new Set<TagId>();
  for (const prompt of library.prompts) {
    if (!prompt.archived) {
      for (const tagId of prompt.tagIds) {
        tagsInUse.add(tagId);
      }
    }
  }
  const launcherTags = library.tags.filter((tag) => tagsInUse.has(tag.id));

  const filtersActive =
    collectionId !== null || tagIds.length > 0 || favoriteOnly;
  const hasRestrictions = query.trim() !== "" || filtersActive;
  const emptyMessage = (() => {
    if (activeCount === 0) {
      return t("launcher.emptyLibrary");
    }
    // A filter-only exclusion must not claim the query found nothing.
    if (query.trim() === "") {
      return t("launcher.emptyFiltered");
    }
    return t("launcher.empty", { query });
  })();

  if (variablesFor !== null) {
    return (
      <div className="pr0-launcher" data-standalone={standalone}>
        <VariablesDialog
          onCancel={() => setVariablesFor(null)}
          onCopy={(values) => {
            void write(variablesFor.id, values);
          }}
          prompt={variablesFor}
        />
        {copyError === null ? null : (
          <div className="pr0-launcher-error" role="alert">
            <TriangleAlert aria-hidden="true" size={16} />
            <span>{t("launcher.error", { message: copyError })}</span>
          </div>
        )}
      </div>
    );
  }

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

      <LauncherFilters
        activeTags={activeTags}
        collectionId={collectionId}
        collections={library.collections}
        favoriteOnly={favoriteOnly}
        onToggleCollection={(id) =>
          setCollectionId((current) => (current === id ? null : id))
        }
        onToggleFavorite={() => setFavoriteOnly((on) => !on)}
        onToggleTag={(id) =>
          setTagIds((current) =>
            activeTags.has(id)
              ? current.filter((tagId) => tagId !== id)
              : [...current, id]
          )
        }
        tags={launcherTags}
      />

      <LauncherResults
        activeId={activeId}
        emptyMessage={emptyMessage}
        filtersActive={filtersActive}
        hasRestrictions={hasRestrictions}
        library={library}
        onClearFilters={() => {
          setCollectionId(null);
          setTagIds([]);
          setFavoriteOnly(false);
        }}
        onClearQuery={() => setQuery("")}
        onHover={setSelectedId}
        onRun={(promptId) => {
          setSelectedId(promptId);
          void copySelected();
        }}
        queryActive={query.trim() !== ""}
        results={results}
      />

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
