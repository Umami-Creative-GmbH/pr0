/**
 * PROTOTYPE (issue #9) — the library surface: list, detail, overlays,
 * keyboard handling and copy outcomes.
 *
 * The library is a controlled prop so the desktop main window can own it and
 * mirror it into the native launcher window.
 */

import { useTolgee, useTranslate } from "@tolgee/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { ClipboardWriter } from "../domain/copy";
import {
  createPrompt,
  deletePrompt,
  duplicatePrompt,
  ensureTags,
  savePrompt,
  setArchived,
  toggleFavorite,
} from "../domain/lifecycle";
import type { Library, Prompt } from "../domain/types";
import {
  createLibraryState,
  effectiveSort,
  libraryReducer,
  selectResults,
} from "../store/library-store";
import { LibraryChrome } from "./library-chrome";
import type { EditorTarget } from "./library-overlays";
import { LibraryOverlays } from "./library-overlays";
import { LibrarySidebar } from "./library-sidebar";
import { PromptDetail } from "./prompt-detail";
import type { EditorDraft } from "./prompt-editor";
import { PrototypeToast } from "./prototype-toast";
import { useLibraryCopy } from "./use-library-copy";

export interface LibraryAppProps {
  library: Library;
  onLibraryChange: (next: Library) => void;
  clipboard: ClipboardWriter;
  launcherOpen: boolean;
  onLauncherOpenChange: (open: boolean) => void;
  surface: "web" | "desktop";
  /** True when a native window hosts the launcher, so no overlay is drawn. */
  launcherIsNative?: boolean;
  statusNote?: string;
  now: number;
}

export const LibraryApp = ({
  library,
  onLibraryChange,
  clipboard,
  launcherOpen,
  onLauncherOpenChange,
  surface,
  launcherIsNative = false,
  statusNote,
  now,
}: LibraryAppProps) => {
  const { t } = useTranslate();
  const tolgee = useTolgee(["language"]);
  const locale = tolgee.getLanguage() ?? "de";

  const [state, dispatch] = useReducer(
    libraryReducer,
    library,
    createLibraryState
  );
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [deleteFor, setDeleteFor] = useState<Prompt | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the reducer's library in step with the controlled prop.
  useEffect(() => {
    dispatch({ type: "setLibrary", library });
  }, [library]);

  const results = useMemo(() => selectResults(state), [state]);
  const selected =
    results.find((prompt) => prompt.id === state.selectedId) ?? null;

  const {
    toast,
    showToast,
    requestCopy,
    copyResolved,
    copyFromLauncher,
    variablesFor,
    setVariablesFor,
  } = useLibraryCopy({
    clipboard,
    copiedLabel: t("toast.copied"),
    failedLabel: t("toast.copyFailed"),
    library,
    onLibraryChange,
  });

  const overlayOpen =
    editor !== null ||
    variablesFor !== null ||
    deleteFor !== null ||
    launcherOpen;

  // The key handler reads the latest values through a ref so the listener is
  // attached once rather than re-subscribing on every render.
  const keyContext = useRef({
    launcherOpen,
    overlayOpen,
    selected,
    onLauncherOpenChange,
    requestCopy,
    setVariablesFor,
  });
  useEffect(() => {
    keyContext.current = {
      launcherOpen,
      overlayOpen,
      selected,
      onLauncherOpenChange,
      requestCopy,
      setVariablesFor,
    };
  });

  // Global keyboard handling for the library surface.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const context = keyContext.current;
      const meta = event.metaKey || event.ctrlKey;
      // SAFETY: a DOM keydown target is an element or null.
      const target = event.target as HTMLElement | null;
      const typing = /^(?<tag>input|textarea|select)$/iu.test(
        target?.tagName ?? ""
      );

      if (meta && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        context.onLauncherOpenChange(!context.launcherOpen);
        return;
      }

      if (event.key === "Escape") {
        setEditor(null);
        context.setVariablesFor(null);
        setDeleteFor(null);
        context.onLauncherOpenChange(false);
        return;
      }

      if (context.overlayOpen) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        dispatch({ type: "move", delta: 1 });
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        dispatch({ type: "move", delta: -1 });
        return;
      }
      if (event.key === "Enter" && (meta || !typing)) {
        event.preventDefault();
        context.requestCopy(context.selected);
        return;
      }
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Keep the selected row in view when the keyboard moves it.
  useEffect(() => {
    if (state.selectedId === null) {
      return;
    }
    const index = results.findIndex((prompt) => prompt.id === state.selectedId);
    const row = listRef.current?.children[index];
    row?.scrollIntoView({ block: "nearest" });
  }, [results, state.selectedId]);

  const saveEditor = (draft: EditorDraft) => {
    const resolved = ensureTags(library, draft.tagNames);
    const at = Date.now();
    const payload = {
      title: draft.title,
      description: draft.description,
      content: draft.content,
      collectionId: draft.collectionId,
      tagIds: resolved.tagIds,
    };

    if (editor?.prompt) {
      onLibraryChange(
        savePrompt(resolved.library, editor.prompt.id, payload, at)
      );
    } else {
      const id = `p-${at.toString(36)}`;
      onLibraryChange(createPrompt(resolved.library, payload, at, id));
      dispatch({ type: "select", id });
    }
    setEditor(null);
  };

  return (
    <>
      <LibraryChrome
        onOpenLauncher={() => onLauncherOpenChange(true)}
        statusNote={statusNote}
        surface={surface}
      />

      <div className="pr0-body">
        <LibrarySidebar
          filters={state.filters}
          library={library}
          listRef={listRef}
          locale={locale}
          now={now}
          onClearFilters={() => dispatch({ type: "clearFilters" })}
          onClearQuery={() => dispatch({ type: "clearQuery" })}
          onCollectionFilter={(collectionId) =>
            dispatch({ type: "setCollectionFilter", collectionId })
          }
          onFavoriteFilter={() => dispatch({ type: "toggleFavoriteFilter" })}
          onNew={() => setEditor({ prompt: null, initialTitle: "" })}
          onQueryChange={(query) => dispatch({ type: "setQuery", query })}
          onSelect={(id) => dispatch({ type: "select", id })}
          onSortChange={(sort) => dispatch({ type: "setSort", sort })}
          onTagFilter={(tagId) => dispatch({ type: "toggleTagFilter", tagId })}
          onToggleFavorite={(id) =>
            onLibraryChange(toggleFavorite(library, id, Date.now()))
          }
          onViewChange={(view) => dispatch({ type: "setView", view })}
          query={state.query}
          results={results}
          searchRef={searchRef}
          selectedId={state.selectedId}
          sort={effectiveSort(state)}
          view={state.view}
        />

        <PromptDetail
          library={library}
          locale={locale}
          now={now}
          onCopy={() => requestCopy(selected)}
          onDelete={() => selected && setDeleteFor(selected)}
          onDuplicate={() => {
            if (!selected) {
              return;
            }
            const at = Date.now();
            onLibraryChange(
              duplicatePrompt(library, selected.id, at, `p-${at.toString(36)}`)
            );
            showToast({
              tone: "success",
              label: t("toast.duplicated"),
              detail: selected.title,
            });
          }}
          onEdit={() =>
            selected && setEditor({ prompt: selected, initialTitle: "" })
          }
          onToggleArchive={() => {
            if (!selected) {
              return;
            }
            const archiving = !selected.archived;
            onLibraryChange(
              setArchived(library, selected.id, archiving, Date.now())
            );
            showToast({
              tone: "success",
              label: archiving ? t("toast.archived") : t("toast.restored"),
              detail: selected.title,
            });
          }}
          onToggleFavorite={() =>
            selected &&
            onLibraryChange(toggleFavorite(library, selected.id, Date.now()))
          }
          prompt={selected}
        />
      </div>

      <LibraryOverlays
        deleteFor={deleteFor}
        editor={editor}
        launcherOpen={launcherOpen && !launcherIsNative}
        library={library}
        onDeleteClose={() => setDeleteFor(null)}
        onDeleteConfirm={(prompt) => {
          onLibraryChange(deletePrompt(library, prompt.id));
          showToast({
            tone: "success",
            label: t("toast.deleted"),
            detail: prompt.title,
          });
          setDeleteFor(null);
        }}
        onEditorClose={() => setEditor(null)}
        onEditorSave={saveEditor}
        onLauncherClose={() => onLauncherOpenChange(false)}
        onLauncherCopy={copyFromLauncher}
        onLauncherOpenPrompt={(promptId) =>
          dispatch({ type: "select", id: promptId })
        }
        onVariablesClose={() => setVariablesFor(null)}
        onVariablesCopy={(prompt, values) => {
          setVariablesFor(null);
          void copyResolved(prompt, values);
        }}
        variablesFor={variablesFor}
      />

      {toast === null ? null : <PrototypeToast toast={toast} />}
    </>
  );
};
