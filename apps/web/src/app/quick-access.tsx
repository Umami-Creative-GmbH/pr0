"use client";

import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { Collection, Tag } from "@pr0/api-contract/prompts";
import { WayfinderDialog } from "@pr0/ui/components/wayfinder-dialog";
import { accentFor } from "@pr0/ui/lib/present";
import { Search } from "lucide-react";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { PromptCopyStatus } from "./prompt-copy-status";
import { PromptVariables } from "./prompt-variables";
import { useLibraryFilters } from "./use-library-filters";
import { useLibraryResults } from "./use-library-results";
import type { usePromptCopy } from "./use-prompt-copy";
import { usePromptSearch } from "./use-prompt-search";

export const useQuickResults = (
  library: PrivateLibrary,
  organization: { collections: Collection[]; tags: Tag[] } | undefined,
  open: boolean
) => {
  const { filters, setFilters } = useLibraryFilters();
  const search = usePromptSearch(
    `${library.instance.id}:${library.account.id}:quick-access`,
    "recently-used"
  );
  const results = useLibraryResults({
    library,
    ...filters,
    search,
    organization,
    active: open,
  });
  return { filters, setFilters, search, ...results, organization };
};

export const QuickAccess = ({
  quick,
  copy,
  onClose,
  onOpen,
}: {
  quick: ReturnType<typeof useQuickResults>;
  copy: ReturnType<typeof usePromptCopy>;
  onClose: () => void;
  onOpen: (id: string) => void;
}) => {
  const selectedTags = new Set(quick.filters.tagIds);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const move = (event: KeyboardEvent, id?: string) => {
    if (quick.searchBlocked || copy.blocked) {
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      const selected = id ?? quick.selectedId;
      if (selected) {
        event.preventDefault();
        onOpen(selected);
      }
      return;
    }
    const index = quick.prompts.findIndex((prompt) => prompt.id === id);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        quick.prompts[
          event.key === "ArrowDown"
            ? Math.min(index + 1, quick.prompts.length - 1)
            : Math.max(index - 1, 0)
        ];
      if (next) {
        rows.current.get(next.id)?.focus();
      }
    }
    if (event.key === "Enter" && !id && quick.selectedId) {
      event.preventDefault();
      void copy.copy(quick.selectedId);
    }
  };
  const collectionNames = new Map(
    quick.organization?.collections.map((entry) => [entry.id, entry.name])
  );
  const activeFilters =
    Number(quick.filters.favorite) +
    Number(Boolean(quick.filters.collectionId)) +
    quick.filters.tagIds.length;
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);
  return (
    <WayfinderDialog
      label="Quick access"
      size="launcher"
      onRequestClose={() => {
        if (copy.busy) {
          return;
        }
        if (copy.interaction) {
          copy.cancelVariables();
        } else {
          onClose();
        }
      }}
    >
      <div className="wf-launcher">
        <div className="contents" hidden={Boolean(copy.interaction)}>
          <div className="wf-launcher-search">
            <Search aria-hidden="true" size={18} />
            <input
              aria-label="Find and copy a prompt"
              type="search"
              placeholder="Find a prompt and copy it with ↵…"
              value={quick.search.query}
              onChange={(event) => quick.search.changeQuery(event.target.value)}
              onKeyDown={(event) => move(event)}
            />
            <kbd aria-hidden="true" className="wf-kbd">
              esc
            </kbd>
          </div>
          <details
            className="wf-launcher-filters"
            open={filtersOpen}
            onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
          >
            <summary>
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </summary>
            <fieldset className="wf-chips" aria-label="Quick access filters">
              <button
                className="wf-chip"
                type="button"
                aria-pressed={quick.filters.favorite}
                onClick={() =>
                  quick.setFilters({
                    ...quick.filters,
                    favorite: !quick.filters.favorite,
                  })
                }
              >
                Favorites only
              </button>
              {quick.organization?.collections.map((collection) => (
                <button
                  className="wf-chip"
                  key={collection.id}
                  type="button"
                  aria-pressed={quick.filters.collectionId === collection.id}
                  onClick={() =>
                    quick.setFilters({
                      ...quick.filters,
                      collectionId:
                        quick.filters.collectionId === collection.id
                          ? null
                          : collection.id,
                    })
                  }
                >
                  <span
                    className="wf-dot"
                    data-accent={accentFor(collection.id)}
                  />
                  {collection.name}
                </button>
              ))}
              {quick.organization?.tags.map((tag) => (
                <button
                  className="wf-chip"
                  data-kind="tag"
                  key={tag.id}
                  type="button"
                  aria-pressed={selectedTags.has(tag.id)}
                  onClick={() =>
                    quick.setFilters({
                      ...quick.filters,
                      tagIds: selectedTags.has(tag.id)
                        ? quick.filters.tagIds.filter((id) => id !== tag.id)
                        : [...quick.filters.tagIds, tag.id],
                    })
                  }
                >
                  #{tag.name}
                </button>
              ))}
            </fieldset>
          </details>
          <div className="wf-launcher-status">
            {quick.search.pending || quick.list.isPending ? (
              <output className="wf-hint">Finding prompts…</output>
            ) : null}
            {quick.search.error ? (
              <p className="wf-error" role="alert">
                {quick.search.error}
              </p>
            ) : null}
            {quick.list.isError ? (
              <div className="wf-notice" role="alert">
                Could not load prompts.{" "}
                <button
                  className="wf-link"
                  type="button"
                  onClick={() => {
                    void quick.list.refetch();
                  }}
                >
                  Retry search
                </button>
              </div>
            ) : null}
            <PromptCopyStatus copy={copy} />
          </div>
          <div className="wf-launcher-list">
            <ul aria-label="Quick access results">
              {quick.prompts.map((prompt) => (
                <li key={prompt.id}>
                  <button
                    type="button"
                    className="wf-launcher-row"
                    aria-pressed={prompt.id === quick.selectedId}
                    disabled={copy.blocked || quick.searchBlocked}
                    ref={(element) => {
                      if (element) {
                        rows.current.set(prompt.id, element);
                      } else {
                        rows.current.delete(prompt.id);
                      }
                    }}
                    onFocus={() => quick.setSelected(prompt.id)}
                    onKeyDown={(event) => move(event, prompt.id)}
                    onClick={() => {
                      void copy.copy(prompt.id);
                    }}
                  >
                    <span
                      className="wf-dot"
                      data-accent={accentFor(prompt.collectionId)}
                    />
                    <strong>{prompt.title}</strong>
                    <span className="wf-mono" aria-hidden="true">
                      {prompt.collectionId
                        ? collectionNames.get(prompt.collectionId)
                        : ""}
                    </span>
                    <kbd>
                      <span className="sr-only">Copy </span>↵
                    </kbd>
                  </button>
                </li>
              ))}
            </ul>
            {!quick.list.isPending &&
            !quick.searchBlocked &&
            !quick.prompts.length ? (
              <p className="wf-launcher-note">No matching prompts</p>
            ) : null}
            {quick.list.hasNextPage ? (
              <button
                className="wf-btn-quiet mx-auto my-2"
                type="button"
                disabled={quick.list.isFetchingNextPage}
                onClick={() => {
                  void quick.list.fetchNextPage();
                }}
              >
                Load more prompts
              </button>
            ) : null}
          </div>
        </div>
        <PromptVariables copy={copy} inline />
        <footer className="wf-launcher-foot">
          {copy.interaction ? null : (
            <>
              <span>↑↓ Navigate</span>
              <span>↵ Copy</span>
              <span>Ctrl ↵ Open</span>
            </>
          )}
          <span className="wf-grow" />
          {copy.interaction || quick.list.isPending ? null : (
            <span>
              {quick.prompts.length}
              {quick.list.hasNextPage ? "+" : ""} shown
            </span>
          )}
          <button
            className="wf-btn-quiet"
            type="button"
            disabled={copy.busy}
            onClick={() => {
              copy.cancelVariables();
              onClose();
            }}
          >
            Close quick access
          </button>
        </footer>
      </div>
    </WayfinderDialog>
  );
};
