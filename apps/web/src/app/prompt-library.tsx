"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { promptLimits } from "@pr0/api-contract/prompts";
import type {
  Prompt,
  MutationReceipt,
  PromptView,
} from "@pr0/api-contract/prompts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { PromptActionStatus } from "./prompt-action-status";
import { PromptConflicts } from "./prompt-conflicts";
import { PromptEditor } from "./prompt-editor";
import { retryPromptRead, promptRetryDelay } from "./prompt-query";
import { usePromptActions } from "./use-prompt-actions";
import type { PromptAction } from "./use-prompt-actions";
import { usePromptSelection } from "./use-prompt-selection";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const errorMessage = (error: Error) =>
  error instanceof PromptApiError
    ? error.message
    : "Could not load prompts. Try again.";
const PromptDetail = ({
  detail,
  onEdit,
  editing,
  onAction,
  actionsBlocked,
}: {
  detail: ReturnType<typeof usePromptSelection>["detail"];
  onEdit: (prompt: Prompt) => void;
  editing: boolean;
  onAction: (prompt: Prompt, action: PromptAction, value?: boolean) => void;
  actionsBlocked: boolean;
}) => (
  <section aria-labelledby="detail-heading" className="rounded-lg border p-6">
    <h2 className="text-xl font-semibold break-words" id="detail-heading">
      {detail.data?.title ?? "Prompt detail"}
    </h2>
    {detail.isPending ? <output>Loading prompt…</output> : null}
    {detail.isError ? (
      <div role="alert">
        <p>{errorMessage(detail.error)}</p>
        <button
          className={buttonClass}
          onClick={() => {
            void detail.refetch();
          }}
          type="button"
        >
          Retry detail
        </button>
      </div>
    ) : null}
    {detail.data ? (
      <>
        <button
          className={`${buttonClass} mt-3`}
          disabled={editing}
          onClick={() => {
            if (detail.data) {
              onEdit(detail.data);
            }
          }}
          type="button"
        >
          Edit prompt
        </button>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={buttonClass}
            type="button"
            aria-pressed={detail.data.favorite}
            disabled={actionsBlocked}
            onClick={() => {
              if (detail.data) {
                onAction(detail.data, "favorite", !detail.data.favorite);
              }
            }}
          >
            {detail.data.favorite ? "Unfavorite prompt" : "Favorite prompt"}
          </button>
          <button
            className={buttonClass}
            type="button"
            disabled={actionsBlocked}
            onClick={() => {
              if (detail.data) {
                onAction(detail.data, "duplicate");
              }
            }}
          >
            Duplicate prompt
          </button>
          <button
            className={buttonClass}
            type="button"
            disabled={actionsBlocked}
            onClick={() => {
              if (detail.data) {
                onAction(detail.data, "archived", !detail.data.archived);
              }
            }}
          >
            {detail.data.archived ? "Restore prompt" : "Archive prompt"}
          </button>
        </div>
        {detail.data.sourceTitle &&
        detail.data.title !== `${detail.data.sourceTitle} (copy)` ? (
          <p className="mt-3 break-words">
            Original title: {detail.data.sourceTitle}
          </p>
        ) : null}
        {detail.data.description ? (
          <p className="mt-3 break-words whitespace-pre-wrap">
            {detail.data.description}
          </p>
        ) : null}
        <h3 className="mt-4 font-medium">Content</h3>
        <textarea
          aria-label="Saved content"
          className="bg-background mt-2 max-h-96 w-full rounded-md border p-3 font-mono text-sm"
          readOnly
          rows={10}
          value={detail.data.content}
        />
        <p className="text-muted-foreground mt-3 text-sm">
          Created{" "}
          <time dateTime={detail.data.createdAt}>
            {new Date(detail.data.createdAt).toLocaleString()}
          </time>{" "}
          · Modified{" "}
          <time dateTime={detail.data.modifiedAt}>
            {new Date(detail.data.modifiedAt).toLocaleString()}
          </time>
        </p>
      </>
    ) : null}
  </section>
);
const PromptListRow = ({
  prompt,
  selectedId,
  setSelected,
  actions,
}: {
  prompt: Pick<
    Prompt,
    "id" | "title" | "description" | "favorite" | "archived"
  >;
  selectedId: string | null;
  setSelected: (id: string) => void;
  actions: ReturnType<typeof usePromptActions>;
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
    </div>
  </li>
);
const nearingCapacity = (usage?: { promptCount: number; textBytes: number }) =>
  Boolean(
    usage &&
    (usage.promptCount >= promptLimits.promptCount * 0.9 ||
      usage.textBytes >= promptLimits.libraryBytes * 0.9)
  );
const emptyViewMessage = (view: PromptView) =>
  view === "all"
    ? "Create your first prompt with a title and content."
    : `No prompts in ${view === "archive" ? "the archive" : "favorites"}.`;
export const PromptLibrary = ({
  library,
  onDirtyChange,
}: {
  library: PrivateLibrary;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Prompt | "create" | null>(null);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<PromptView>("all");
  const editorDirty = useRef(false);
  const actionDirty = useRef(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      createRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  const queryKey = [
    "prompts",
    client.baseUrl,
    library.instance.id,
    library.account.id,
    view,
  ];
  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      client.getPrompts({ cursor: pageParam || undefined, view }, signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: retryPromptRead,
    retryDelay: promptRetryDelay,
    refetchOnWindowFocus: false,
  });
  const usage = list.data?.pages[0]?.usage;
  const prompts = list.data?.pages.flatMap((page) => page.prompts) ?? [];
  const { selectedId, setSelected, detail } = usePromptSelection({
    library,
    view,
    prompts,
    incomplete: list.isFetching || list.hasNextPage,
    loading: list.isPending,
  });
  const empty = list.isSuccess && !prompts.length;
  const saved = (receipt: MutationReceipt) => {
    restoreFocus.current = true;
    setEditing(null);
    setSelected(receipt.conflict?.copyId ?? receipt.promptId);
    setNotice(
      receipt.conflict
        ? "Saved to server. Competing text was preserved in an independent conflict copy."
        : "Saved to server."
    );
  };
  const accepted = () => {
    void queryClient.resetQueries({ queryKey: queryKey.slice(0, -1) });
    void queryClient.invalidateQueries({
      queryKey: [
        "prompt",
        client.baseUrl,
        library.instance.id,
        library.account.id,
      ],
    });
    void queryClient.resetQueries({
      queryKey: [
        "conflicts",
        client.baseUrl,
        library.instance.id,
        library.account.id,
      ],
    });
  };
  const actions = usePromptActions({
    library,
    onDirtyChange: (dirty) => {
      actionDirty.current = dirty;
      onDirtyChange(dirty || editorDirty.current);
    },
    onAccepted: (receipt, action, message) => {
      accepted();
      setNotice(message);
      if (action === "duplicate") {
        setView("all");
        setSelected(receipt.promptId);
      }
      noticeRef.current?.focus();
    },
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" ref={noticeRef} tabIndex={-1}>
          {notice}
        </p>
        <button
          className={buttonClass}
          disabled={Boolean(editing)}
          onClick={() => {
            setEditing("create");
            setNotice("");
          }}
          ref={createRef}
          type="button"
        >
          Create prompt
        </button>
      </div>
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
              setView(value);
              setSelected(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <PromptActionStatus actions={actions} />
      <PromptConflicts library={library} onOpen={setSelected} />
      {usage ? (
        <p className="text-muted-foreground text-sm">
          {usage.promptCount.toLocaleString()} / 10,000 prompts ·{" "}
          {(usage.textBytes / 1_048_576).toFixed(2)} / 100 MiB of text
        </p>
      ) : null}
      {nearingCapacity(usage) ? (
        <output>
          Your library is at or above 90% capacity. Archiving does not free
          capacity.
        </output>
      ) : null}
      {editing ? (
        <PromptEditor
          library={library}
          prompt={editing === "create" ? undefined : editing}
          onOpen={setSelected}
          onCancel={() => {
            restoreFocus.current = true;
            setEditing(null);
          }}
          onDirtyChange={(dirty) => {
            editorDirty.current = dirty;
            onDirtyChange(dirty || actionDirty.current);
          }}
          onSaved={saved}
          onAccepted={accepted}
        />
      ) : null}
      <section
        aria-labelledby="prompts-heading"
        className="rounded-lg border p-6"
      >
        <h2 className="text-xl font-semibold" id="prompts-heading">
          {empty && view === "all" ? "Your library is empty" : "Saved prompts"}
        </h2>
        {list.isPending ? <output>Loading your library…</output> : null}
        {empty ? (
          <p className="text-muted-foreground mt-2">{emptyViewMessage(view)}</p>
        ) : null}
        {list.isError ? (
          <div role="alert">
            <p>{errorMessage(list.error)}</p>
            <button
              className={buttonClass}
              onClick={() => {
                void queryClient.resetQueries({ queryKey });
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
      {selectedId ? (
        <PromptDetail
          detail={detail}
          key={selectedId}
          editing={Boolean(editing)}
          onEdit={(prompt) => {
            setEditing(prompt);
            setNotice("");
          }}
          actionsBlocked={actions.blocked}
          onAction={(prompt, action, value) => {
            void actions.act(prompt, action, value);
          }}
        />
      ) : null}
    </div>
  );
};
