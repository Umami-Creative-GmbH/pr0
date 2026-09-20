"use client";
import { PromptApiError } from "@pr0/api-client/prompts";
import type {
  Prompt,
  PromptView,
  promptPageSchema,
} from "@pr0/api-contract/prompts";
import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import type { z } from "zod";

import type { usePromptActions } from "./use-prompt-actions";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const errorMessage = (error: Error) =>
  error instanceof PromptApiError
    ? error.message
    : "Could not load prompts. Try again.";
const PromptListRow = ({
  prompt,
  selectedId,
  setSelected,
  actions,
  onDelete,
}: {
  prompt: Pick<
    Prompt,
    "id" | "title" | "description" | "favorite" | "archived" | "revision"
  >;
  selectedId: string | null;
  setSelected: (id: string) => void;
  actions: ReturnType<typeof usePromptActions>;
  onDelete: (prompt: Pick<Prompt, "id" | "title" | "revision">) => void;
}) => (
  <li>
    <button
      aria-pressed={selectedId === prompt.id}
      className="w-full rounded-md border px-3 py-3 text-left break-words focus-visible:outline-2 focus-visible:outline-offset-2"
      onClick={() => setSelected(prompt.id)}
      type="button"
    >
      <span className="block font-medium">{prompt.title}</span>
      {prompt.description ? (
        <span className="text-muted-foreground mt-1 block text-sm">
          {prompt.description}
        </span>
      ) : null}
    </button>
    <div className="mt-1 flex flex-wrap gap-2">
      <button
        className={buttonClass}
        type="button"
        aria-label={`${prompt.favorite ? "Unfavorite" : "Favorite"} ${prompt.title}`}
        aria-pressed={prompt.favorite}
        disabled={actions.blocked}
        onClick={() => {
          void actions.act(prompt, "favorite", !prompt.favorite);
        }}
      >
        {prompt.favorite ? "Unfavorite" : "Favorite"}
      </button>
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
    </div>
  </li>
);
const emptyViewMessage = (view: PromptView) =>
  view === "all"
    ? "Create your first prompt with a title and content."
    : `No prompts in ${view === "archive" ? "the archive" : "favorites"}.`;
export const PromptResults = ({
  view,
  collectionId,
  list,
  prompts,
  selectedId,
  setSelected,
  actions,
  onDelete,
  onRefresh,
}: {
  view: PromptView;
  collectionId: string | null;
  list: UseInfiniteQueryResult<
    InfiniteData<z.infer<typeof promptPageSchema>>,
    Error
  >;
  prompts: z.infer<typeof promptPageSchema>["prompts"];
  selectedId: string | null;
  setSelected: (id: string) => void;
  actions: ReturnType<typeof usePromptActions>;
  onDelete: (prompt: Pick<Prompt, "id" | "title" | "revision">) => void;
  onRefresh: () => void;
}) => {
  const empty = list.isSuccess && !prompts.length;
  return (
    <section
      aria-labelledby="prompts-heading"
      className="rounded-lg border p-6"
    >
      <h2 className="text-xl font-semibold" id="prompts-heading">
        {empty && view === "all" && !collectionId
          ? "Your library is empty"
          : "Saved prompts"}
      </h2>
      {list.isPending ? <output>Loading your library…</output> : null}
      {empty ? (
        <p className="text-muted-foreground mt-2">
          {collectionId
            ? "No prompts in this collection for the selected view. Remove the collection filter to see other prompts."
            : emptyViewMessage(view)}
        </p>
      ) : null}
      {list.isError ? (
        <div role="alert">
          <p>{errorMessage(list.error)}</p>
          <button
            className={buttonClass}
            onClick={() => {
              onRefresh();
            }}
            type="button"
          >
            Refresh list
          </button>
        </div>
      ) : null}
      <ul className="mt-4 space-y-2">
        {prompts.map((prompt) => (
          <PromptListRow
            key={prompt.id}
            prompt={prompt}
            selectedId={selectedId}
            setSelected={setSelected}
            actions={actions}
            onDelete={onDelete}
          />
        ))}
      </ul>
      {list.hasNextPage ? (
        <button
          className={`${buttonClass} mt-4`}
          disabled={list.isFetchingNextPage || list.isError}
          onClick={() => {
            void list.fetchNextPage();
          }}
          type="button"
        >
          {list.isFetchingNextPage ? "Loading…" : "Load more prompts"}
        </button>
      ) : null}
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
  <nav aria-label="Prompt views" className="flex flex-wrap gap-2">
    {(
      [
        ["all", "All prompts"],
        ["favorites", "Favorites"],
        ["archive", "Archive"],
      ] as const
    ).map(([value, label]) => (
      <button
        className={buttonClass}
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
