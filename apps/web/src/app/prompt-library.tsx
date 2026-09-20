"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { promptLimits } from "@pr0/api-contract/prompts";
import type {
  Collection,
  Tag,
  Prompt,
  MutationReceipt,
  PromptView,
} from "@pr0/api-contract/prompts";
import { PromptDeleteDialog } from "@pr0/ui/components/prompt-delete-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { CollectionControls } from "./collection-controls";
import { PromptActionStatus } from "./prompt-action-status";
import { PromptConflicts } from "./prompt-conflicts";
import { PromptCopyStatus } from "./prompt-copy-status";
import { PromptEditor } from "./prompt-editor";
import { PromptExtraFilters } from "./prompt-extra-filters";
import { PromptResults, PromptViewNavigation } from "./prompt-results";
import { promptSaveNotice } from "./prompt-save-notice";
import { PromptSearchControls } from "./prompt-search-controls";
import { PromptTags } from "./prompt-tags";
import { useCopyEligibility } from "./use-copy-eligibility";
import { useLibraryDrafts } from "./use-library-drafts";
import { useLibraryFilters } from "./use-library-filters";
import { useLibraryRefresh } from "./use-library-refresh";
import { useLibraryResults } from "./use-library-results";
import { useOrganization } from "./use-organization";
import { usePromptActions } from "./use-prompt-actions";
import type { PromptAction } from "./use-prompt-actions";
import { usePromptCopy } from "./use-prompt-copy";
import { usePromptSearch } from "./use-prompt-search";
import type { usePromptSelection } from "./use-prompt-selection";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const errorMessage = (error: Error) =>
  error instanceof PromptApiError
    ? error.message
    : "Could not load prompts. Try again.";
const PromptDetail = ({
  detail,
  collections,
  tags,
  onTags,
  onEdit,
  editing,
  onAction,
  actionsBlocked,
  onDelete,
  copy,
}: {
  copy: ReturnType<typeof usePromptCopy>;
  collections: Collection[];
  tags: Tag[];
  onTags: (prompt: Prompt) => void;
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
            disabled={copy.blocked || editing}
            onClick={() => {
              if (detail.data) {
                void copy.copy(detail.data.id);
              }
            }}
          >
            Copy prompt
          </button>
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
          Tags:{" "}
          {detail.data.tagIds
            .map(
              (id) => tags.find((tag) => tag.id === id)?.name ?? "Unavailable"
            )
            .join(", ") || "None"}
        </p>
        <button
          type="button"
          className={buttonClass}
          disabled={editing}
          onClick={() => {
            if (detail.data) {
              onTags(detail.data);
            }
          }}
        >
          Edit tags
        </button>
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
  accountAvailable = true,
}: {
  accountAvailable?: boolean;
  library: PrivateLibrary;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const client = useApiClient();
  const markDraft = useLibraryDrafts(onDirtyChange);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Prompt | "create" | null>(null);
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<Pick<
    Prompt,
    "id" | "title" | "revision"
  > | null>(null);
  const { filters, setFilters, hasExtraFilters } = useLibraryFilters();
  const { view, viewCollectionId, collectionId, tagIds, favorite } = filters;
  const [tagEditing, setTagEditing] = useState<Prompt | null>(null);

  const sortScope = [
    library.instance.id,
    library.account.id,
    view,
    viewCollectionId,
  ].join(":");
  const search = usePromptSearch(
    sortScope,
    view === "recents" ? "recently-used" : "recently-modified"
  );
  const { organization } = useOrganization(library);
  const { collections, tags } = organization.data ?? {
    collections: [],
    tags: [],
  };
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      createRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  const {
    list,
    queryKey,
    restarted,
    searchBlocked,
    usage,
    prompts,
    selectedId,
    setSelected,
    detail,
  } = useLibraryResults({
    library,
    view,
    collectionId,
    viewCollectionId,
    favorite,
    tagIds,
    search,
    organization: organization.data,
  });
  const saved = (receipt: MutationReceipt) => {
    restoreFocus.current = true;
    setEditing(null);
    setSelected(receipt.conflict?.copyId ?? receipt.promptId);
    setNotice(promptSaveNotice(receipt));
  };
  const changeView = (value: PromptView, id: string | null = null) => {
    search.clear();
    setFilters({
      view: value,
      viewCollectionId: id,
      collectionId: null,
      tagIds: [],
      favorite: false,
    });
  };
  const detailUnavailable = detail.isFetching || detail.isError;
  const accepted = useLibraryRefresh(library);
  const actions = usePromptActions({
    library,
    onDirtyChange: (dirty) => markDraft("action", dirty),
    onAccepted: async (receipt, action, message) => {
      await accepted();
      setNotice(
        receipt.conflict
          ? `${message} Unseen text was preserved in a conflict copy.`
          : message
      );
      if (action === "delete") {
        setSelected(receipt.conflict?.copyId ?? null);
        if (receipt.conflict) {
          changeView("all");
        }
      }
      if (action === "duplicate") {
        changeView("all");
        setSelected(receipt.promptId);
      }
      noticeRef.current?.focus();
    },
  });
  const eligible = useCopyEligibility({
    accountAvailable,
    searchBlocked,
    view,
    collectionId,
    viewCollectionId,
    tagIds,
    favorite,
    query: search.query,
    collections,
    tags,
    prompts,
    selectedId,
  });
  const copy = usePromptCopy({
    library,
    eligible,
    onAccepted: accepted,
  });
  const openPrompt = async (id: string) => {
    try {
      const prompt = await client.getPrompt(id, AbortSignal.timeout(30_000), {
        instanceId: library.instance.id,
        accountId: library.account.id,
      });
      changeView(prompt.archived ? "archive" : "all");
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
      <PromptViewNavigation view={view} onChange={changeView} />
      <PromptSearchControls search={search} />
      <PromptExtraFilters
        favorite={favorite}
        hasExtraFilters={hasExtraFilters}
        onFavorite={(value) => setFilters({ ...filters, favorite: value })}
        onClear={() =>
          setFilters({
            ...filters,
            collectionId: null,
            tagIds: [],
            favorite: false,
          })
        }
      />
      {restarted ? (
        <output>
          Your library changed. Results restarted from the first page.
        </output>
      ) : null}
      <CollectionControls
        tagIds={tagIds}
        onTagsChange={(ids) => {
          setFilters({ ...filters, tagIds: ids });
        }}
        viewCollectionId={viewCollectionId}
        onNavigateCollection={(id) => {
          changeView(id ? "collection" : "all", id);
        }}
        library={library}
        organization={organization}
        onAccepted={accepted}
        onAllPrompts={() => changeView("all")}
        collectionId={collectionId}
        onSelect={(id) => {
          setFilters({ ...filters, collectionId: id });
        }}
        onDirtyChange={(dirty) => markDraft("organization", dirty)}
      />
      {tagEditing ? (
        <PromptTags
          library={library}
          prompt={tagEditing}
          tags={tags}
          onAccepted={accepted}
          onDirtyChange={(dirty) => markDraft("tags", dirty)}
          onClose={() => setTagEditing(null)}
        />
      ) : null}
      <PromptActionStatus actions={actions} />
      <PromptCopyStatus copy={copy} />
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
          tags={tags}
          prompt={editing === "create" ? undefined : editing}
          onOpen={(id) => {
            void openPrompt(id);
          }}
          onCancel={() => {
            restoreFocus.current = true;
            setEditing(null);
          }}
          onDirtyChange={(dirty) => markDraft("editor", dirty)}
          onSaved={saved}
          onAccepted={accepted}
        />
      ) : null}
      <PromptResults
        copy={copy}
        restricted={search.searching || hasExtraFilters}
        pendingSearch={search.pending || Boolean(search.error)}
        view={view}
        collectionId={viewCollectionId}
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
      {selectedId && !searchBlocked ? (
        <PromptDetail
          copy={copy}
          detail={detail}
          collections={collections}
          key={selectedId}
          editing={Boolean(editing || tagEditing) || detailUnavailable}
          tags={tags}
          onTags={setTagEditing}
          onEdit={(prompt) => {
            setEditing(prompt);
            setNotice("");
          }}
          actionsBlocked={actions.blocked || detailUnavailable}
          onDelete={setDeleting}
          onAction={(prompt, action, value) => {
            void actions.act(prompt, action, value);
          }}
        />
      ) : null}
    </div>
  );
};
