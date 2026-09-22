"use client";
import { PromptApiError } from "@pr0/api-client/prompts";
import type {
  Collection,
  Prompt,
  PromptView,
  Tag,
  promptPageSchema,
} from "@pr0/api-contract/prompts";
import {
  PromptIconAction,
  PromptMoreActions,
} from "@pr0/ui/components/prompt-actions";
import { PromptRow } from "@pr0/ui/components/prompt-row";
import { accentFor } from "@pr0/ui/lib/present";
import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import type { z } from "zod";

import type { usePromptActions } from "./use-prompt-actions";
import type { usePromptCopy } from "./use-prompt-copy";

type Summary = z.infer<typeof promptPageSchema>["prompts"][number];
const buttonClass = "wf-menu-item";
const errorMessage = (error: Error) =>
  error instanceof PromptApiError
    ? error.message
    : "Could not load prompts. Try again.";
const PromptListRow = ({
  prompt,
  collection,
  tagNames,
  selectedId,
  setSelected,
  actions,
  onDelete,
  copy,
}: {
  copy: ReturnType<typeof usePromptCopy>;
  prompt: Summary;
  collection?: string;
  tagNames: string[];
  selectedId: string | null;
  setSelected: (id: string) => void;
  actions: ReturnType<typeof usePromptActions>;
  onDelete: (prompt: Pick<Prompt, "id" | "title" | "revision">) => void;
}) => (
  <PromptRow
    title={prompt.title}
    preview={prompt.excerpt}
    collection={collection}
    accent={accentFor(prompt.collectionId)}
    tags={tagNames}
    modifiedAt={prompt.modifiedAt}
    selected={selectedId === prompt.id}
    onSelect={() => setSelected(prompt.id)}
  >
    <PromptIconAction
      kind="copy"
      size="sm"
      label={`Copy ${prompt.title}`}
      disabled={copy.blocked}
      onClick={() => {
        void copy.copy(prompt.id);
      }}
    />
    <PromptMoreActions size="sm" label={`More actions for ${prompt.title}`}>
      <button
        className={buttonClass}
        type="button"
        aria-label={`Duplicate ${prompt.title}`}
        disabled={actions.blocked}
        onClick={() => {
          void actions.act(prompt, "duplicate");
        }}
      >
        Duplicate
      </button>
      <button
        className={buttonClass}
        type="button"
        aria-label={`${prompt.archived ? "Restore" : "Archive"} ${prompt.title}`}
        disabled={actions.blocked}
        onClick={() => {
          void actions.act(prompt, "archived", !prompt.archived);
        }}
      >
        {prompt.archived ? "Restore" : "Archive"}
      </button>
      <button
        className={buttonClass}
        type="button"
        aria-label={`Permanently delete ${prompt.title}`}
        disabled={actions.blocked}
        onClick={() => onDelete(prompt)}
      >
        Delete
      </button>
    </PromptMoreActions>
    <PromptIconAction
      kind="favorite"
      size="sm"
      label={`${prompt.favorite ? "Unfavorite" : "Favorite"} ${prompt.title}`}
      active={prompt.favorite}
      disabled={actions.blocked}
      onClick={() => {
        void actions.act(prompt, "favorite", !prompt.favorite);
      }}
    />
  </PromptRow>
);
const emptyViewMessage = (view: PromptView) => {
  if (view === "recents") {
    return "No recent prompts. Successfully copy a prompt to see it here.";
  }
  return view === "all"
    ? "No active prompts. Create a prompt or open the Archive view."
    : `No prompts in ${view === "archive" ? "the archive" : "favorites"}.`;
};
const resultsHeading = (
  empty: boolean,
  restricted: boolean,
  view: PromptView,
  count?: number
) =>
  empty && !restricted && view === "all" && count === 0
    ? "Your library is empty"
    : "Saved prompts";
const ResultsProgress = ({
  list,
}: {
  list: UseInfiniteQueryResult<
    InfiniteData<z.infer<typeof promptPageSchema>>,
    Error
  >;
}) => (
  <>
    {list.isPending ? (
      <output className="wf-hint px-2">Loading your library…</output>
    ) : null}
    {list.failureReason instanceof PromptApiError &&
    list.failureReason.detail?.code === "search_preparing" ? (
      <output className="wf-hint px-2">
        Search is preparing your latest library…
      </output>
    ) : null}
  </>
);
export const PromptResults = ({
  restricted,
  pendingSearch,
  view,
  collectionId,
  list,
  prompts,
  collections,
  tags,
  selectedId,
  setSelected,
  actions,
  onDelete,
  onRefresh,
  copy,
  headActions,
}: {
  copy: ReturnType<typeof usePromptCopy>;
  restricted: boolean;
  pendingSearch: boolean;
  view: PromptView;
  collectionId: string | null;
  list: UseInfiniteQueryResult<
    InfiniteData<z.infer<typeof promptPageSchema>>,
    Error
  >;
  prompts: Summary[];
  collections: Collection[];
  tags: Tag[];
  selectedId: string | null;
  setSelected: (id: string) => void;
  actions: ReturnType<typeof usePromptActions>;
  onDelete: (prompt: Pick<Prompt, "id" | "title" | "revision">) => void;
  onRefresh: () => void;
  /** Controls beside the count, such as the create button. */
  headActions: ReactNode;
}) => {
  let emptyMessage = emptyViewMessage(view);
  if (collectionId) {
    emptyMessage =
      "This collection is empty. Create a prompt or choose another view.";
  }
  if (restricted) {
    emptyMessage = "No matching prompts";
  }
  const empty = list.isSuccess && !prompts.length && !pendingSearch;
  const collectionNames = new Map(
    collections.map((entry) => [entry.id, entry.name])
  );
  const tagNames = new Map(tags.map((entry) => [entry.id, entry.name]));
  const shown = list.isSuccess && !pendingSearch;
  return (
    <section aria-labelledby="prompts-heading" className="wf-results">
      <div className="wf-list-head">
        <h2 className="wf-eyebrow" id="prompts-heading">
          {resultsHeading(
            empty,
            restricted,
            view,
            list.data?.pages[0]?.usage.promptCount
          )}
        </h2>
        {shown && prompts.length ? (
          <span className="wf-eyebrow" aria-hidden="true">
            {prompts.length}
            {list.hasNextPage ? "+" : ""}
          </span>
        ) : null}
        <span className="wf-grow" />
        {headActions}
      </div>
      <div className="wf-list">
        <ResultsProgress list={list} />
        <output className="sr-only">
          {shown ? `${prompts.length} prompts shown.` : ""}
        </output>
        {empty ? (
          <div className="wf-empty">
            <Inbox aria-hidden="true" size={28} />
            <p>{emptyMessage}</p>
          </div>
        ) : null}
        {list.isError ? (
          <div className="wf-notice mx-1" role="alert">
            <p>{errorMessage(list.error)}</p>
            <button
              className="wf-btn mt-2"
              onClick={() => {
                onRefresh();
              }}
              type="button"
            >
              Refresh list
            </button>
          </div>
        ) : null}
        <ul>
          {prompts.map((prompt) => (
            <PromptListRow
              copy={copy}
              key={prompt.id}
              prompt={prompt}
              collection={
                prompt.collectionId
                  ? collectionNames.get(prompt.collectionId)
                  : undefined
              }
              tagNames={prompt.tagIds.flatMap((id) => tagNames.get(id) ?? [])}
              selectedId={selectedId}
              setSelected={setSelected}
              actions={actions}
              onDelete={onDelete}
            />
          ))}
        </ul>
        {list.hasNextPage ? (
          <button
            className="wf-btn mx-auto mt-2"
            disabled={list.isFetchingNextPage || list.isError}
            onClick={() => {
              void list.fetchNextPage();
            }}
            type="button"
          >
            {list.isFetchingNextPage ? "Loading…" : "Load more prompts"}
          </button>
        ) : null}
      </div>
    </section>
  );
};

export const PromptViewNavigation = ({
  view,
  onChange,
}: {
  view: PromptView;
  onChange: (view: PromptView) => void;
}) => (
  <nav aria-label="Prompt views" className="wf-segment">
    {(
      [
        ["all", "All prompts"],
        ["favorites", "Favorites"],
        ["recents", "Recents"],
        ["archive", "Archive"],
      ] as const
    ).map(([value, label]) => (
      <button
        key={value}
        type="button"
        aria-pressed={view === value}
        onClick={() => {
          onChange(value);
        }}
      >
        {label}
      </button>
    ))}
  </nav>
);
