"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { promptLimits } from "@pr0/api-contract/prompts";
import type {
  Collection,
  Prompt,
  MutationReceipt,
  PromptView,
} from "@pr0/api-contract/prompts";
import { PromptDeleteDialog } from "@pr0/ui/components/prompt-delete-dialog";
import {
  useInfiniteQuery,
  useQueryClient,
  useQuery,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { CollectionControls } from "./collection-controls";
import { PromptActionStatus } from "./prompt-action-status";
import { PromptConflicts } from "./prompt-conflicts";
import { PromptEditor } from "./prompt-editor";
import { retryPromptRead, promptRetryDelay } from "./prompt-query";
import { PromptResults, PromptViewNavigation } from "./prompt-results";
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
  collections,
  onEdit,
  editing,
  onAction,
  actionsBlocked,
  onDelete,
}: {
  collections: Collection[];
  detail: ReturnType<typeof usePromptSelection>["detail"];
  onEdit: (prompt: Prompt) => void;
  editing: boolean;
  onAction: (prompt: Prompt, action: PromptAction, value?: boolean) => void;
  actionsBlocked: boolean;
  onDelete: (prompt: Prompt) => void;
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
          <button
            className={buttonClass}
            type="button"
            disabled={actionsBlocked}
            onClick={() => {
              if (detail.data) {
                onDelete(detail.data);
              }
            }}
          >
            Permanently delete prompt
          </button>
        </div>
        <p className="mt-3">
          Collection:{" "}
          {collections.find((entry) => entry.id === detail.data?.collectionId)
            ?.name ?? (detail.data.collectionId ? "Unavailable" : "None")}
        </p>
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
const nearingCapacity = (usage?: { promptCount: number; textBytes: number }) =>
  Boolean(
    usage &&
    (usage.promptCount >= promptLimits.promptCount * 0.9 ||
      usage.textBytes >= promptLimits.libraryBytes * 0.9)
  );
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
  const [deleting, setDeleting] = useState<Pick<
    Prompt,
    "id" | "title" | "revision"
  > | null>(null);
  const [view, setView] = useState<PromptView>("all");
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const organizationDirty = useRef(false);
  const organizationKey = [
    "organization",
    client.baseUrl,
    library.instance.id,
    library.account.id,
  ];
  const organization = useQuery({
    queryKey: organizationKey,
    queryFn: ({ signal }) =>
      client.getOrganization(signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    retry: retryPromptRead,
    retryDelay: promptRetryDelay,
  });
  const collections = organization.data?.collections ?? [];
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
    collectionId,
  ];
  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      client.getPrompts(
        {
          cursor: pageParam || undefined,
          view,
          collectionId: collectionId ?? undefined,
        },
        signal,
        {
          instanceId: library.instance.id,
          accountId: library.account.id,
        }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: retryPromptRead,
    retryDelay: promptRetryDelay,
    refetchOnWindowFocus: false,
  });
  const pages = list.data?.pages ?? [];
  const usage = pages[0]?.usage;
  const prompts = pages.flatMap((page) => page.prompts);
  const { selectedId, setSelected, detail } = usePromptSelection({
    library,
    view,
    collectionId,
    prompts,
    incomplete: list.isFetching || list.hasNextPage,
    loading: list.isPending,
  });
  const saved = (receipt: MutationReceipt) => {
    restoreFocus.current = true;
    setEditing(null);
    setSelected(receipt.conflict?.copyId ?? receipt.promptId);
    setNotice(
      receipt.conflict
        ? "Saved to server. Competing text was preserved in an independent conflict copy."
        : `Saved to server.${receipt.organizationNotice ? ` ${receipt.organizationNotice}` : ""}`
    );
  };
  const accepted = () => {
    void queryClient.invalidateQueries({ queryKey: organizationKey });
    void queryClient.resetQueries({ queryKey: queryKey.slice(0, 4) });
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
      onDirtyChange(dirty || editorDirty.current || organizationDirty.current);
    },
    onAccepted: (receipt, action, message) => {
      accepted();
      setNotice(
        receipt.conflict
          ? `${message} Unseen text was preserved in a conflict copy.`
          : message
      );
      if (action === "delete") {
        setSelected(receipt.conflict?.copyId ?? null);
        if (receipt.conflict) {
          setView("all");
        }
      }
      if (action === "duplicate") {
        setView("all");
        setCollectionId(null);
        setSelected(receipt.promptId);
      }
      noticeRef.current?.focus();
    },
  });
  const openPrompt = async (id: string) => {
    try {
      const prompt = await client.getPrompt(id, AbortSignal.timeout(30_000), {
        instanceId: library.instance.id,
        accountId: library.account.id,
      });
      setView(prompt.archived ? "archive" : "all");
      setCollectionId(null);
      setSelected(id);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? errorMessage(error)
          : "Could not open this prompt. Try again."
      );
      noticeRef.current?.focus();
    }
  };
  return (
    <div className="space-y-6">
      {deleting ? (
        <PromptDeleteDialog
          title={deleting.title}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            setDeleting(null);
            void actions.act(deleting, "delete");
          }}
        />
      ) : null}
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
      <PromptViewNavigation
        view={view}
        onChange={(value) => {
          setView(value);
          setCollectionId(null);
          setSelected(null);
        }}
      />
      <CollectionControls
        library={library}
        organization={organization}
        onAccepted={accepted}
        collectionId={collectionId}
        onSelect={(id) => {
          setCollectionId(id);
          setSelected(null);
        }}
        onDirtyChange={(dirty) => {
          organizationDirty.current = dirty;
          onDirtyChange(dirty || editorDirty.current || actionDirty.current);
        }}
      />
      <PromptActionStatus actions={actions} />
      <PromptConflicts
        library={library}
        onOpen={(id) => {
          void openPrompt(id);
        }}
      />
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
          collections={collections}
          prompt={editing === "create" ? undefined : editing}
          onOpen={(id) => {
            void openPrompt(id);
          }}
          onCancel={() => {
            restoreFocus.current = true;
            setEditing(null);
          }}
          onDirtyChange={(dirty) => {
            editorDirty.current = dirty;
            onDirtyChange(
              dirty || actionDirty.current || organizationDirty.current
            );
          }}
          onSaved={saved}
          onAccepted={accepted}
        />
      ) : null}
      <PromptResults
        view={view}
        collectionId={collectionId}
        list={list}
        prompts={prompts}
        selectedId={selectedId}
        setSelected={setSelected}
        actions={actions}
        onDelete={setDeleting}
        onRefresh={() => {
          void queryClient.resetQueries({ queryKey });
        }}
      />
      {selectedId ? (
        <PromptDetail
          detail={detail}
          collections={collections}
          key={selectedId}
          editing={Boolean(editing)}
          onEdit={(prompt) => {
            setEditing(prompt);
            setNotice("");
          }}
          actionsBlocked={actions.blocked}
          onDelete={setDeleting}
          onAction={(prompt, action, value) => {
            void actions.act(prompt, action, value);
          }}
        />
      ) : null}
    </div>
  );
};
