"use client";

import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { Collection, Tag } from "@pr0/api-contract/prompts";
import { WayfinderDialog } from "@pr0/ui/components/wayfinder-dialog";
import { useRef } from "react";
import type { KeyboardEvent } from "react";

import { PromptCopyStatus } from "./prompt-copy-status";
import { PromptVariables } from "./prompt-variables";
import { useLibraryFilters } from "./use-library-filters";
import { useLibraryResults } from "./use-library-results";
import type { usePromptCopy } from "./use-prompt-copy";
import { usePromptSearch } from "./use-prompt-search";

export const useQuickResults = (
  library: PrivateLibrary,
  organization?: { collections: Collection[]; tags: Tag[] }
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
  });
  return { filters, setFilters, search, ...results, organization };
};

export const QuickAccess = ({
  quick,
  copy,
  onClose,
}: {
  quick: ReturnType<typeof useQuickResults>;
  copy: ReturnType<typeof usePromptCopy>;
  onClose: () => void;
}) => {
  const selectedTags = new Set(quick.filters.tagIds);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const move = (event: KeyboardEvent, id?: string) => {
    if (quick.searchBlocked || copy.blocked) {
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
  return (
    <WayfinderDialog
      label="Quick access"
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
        <div hidden={Boolean(copy.interaction)}>
          <label className="block">
            Find and copy a prompt
            <input
              type="search"
              className="mt-2 w-full"
              value={quick.search.query}
              onChange={(event) => quick.search.changeQuery(event.target.value)}
              onKeyDown={(event) => move(event)}
            />
          </label>
          <fieldset
            className="wf-quick-filters"
            aria-label="Quick access filters"
          >
            <button
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
                {collection.name}
              </button>
            ))}
            {quick.organization?.tags.map((tag) => (
              <button
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
          {quick.search.pending || quick.list.isPending ? (
            <output>Finding prompts…</output>
          ) : null}
          {quick.search.error ? <p role="alert">{quick.search.error}</p> : null}
          {quick.list.isError ? (
            <div role="alert">
              Could not load prompts.{" "}
              <button
                type="button"
                onClick={() => {
                  void quick.list.refetch();
                }}
              >
                Retry search
              </button>
            </div>
          ) : null}
          <ul aria-label="Quick access results">
            {quick.prompts.map((prompt) => (
              <li key={prompt.id}>
                <button
                  type="button"
                  className="w-full p-3 text-left"
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
                  {prompt.title}
                  <span>Copy ↵</span>
                </button>
              </li>
            ))}
          </ul>
          {!quick.list.isPending &&
          !quick.searchBlocked &&
          !quick.prompts.length ? (
            <p>No matching prompts</p>
          ) : null}
          {quick.list.hasNextPage ? (
            <button
              type="button"
              disabled={quick.list.isFetchingNextPage}
              onClick={() => {
                void quick.list.fetchNextPage();
              }}
            >
              Load more prompts
            </button>
          ) : null}
          <PromptCopyStatus copy={copy} />
        </div>
        <PromptVariables copy={copy} inline />
        <div className="mt-4 flex items-center justify-between gap-3">
          <span>↑↓ Navigate · Enter Copy</span>
          <button
            type="button"
            disabled={copy.busy}
            onClick={() => {
              copy.cancelVariables();
              onClose();
            }}
          >
            Close quick access
          </button>
        </div>
      </div>
    </WayfinderDialog>
  );
};
