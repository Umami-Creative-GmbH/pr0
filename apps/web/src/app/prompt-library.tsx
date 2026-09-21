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
import { templateSpans } from "@pr0/api-contract/variables";
import {
  PromptMoreActions,
  PromptIconAction,
} from "@pr0/ui/components/prompt-actions";
import { PromptContent } from "@pr0/ui/components/prompt-content";
import { PromptDeleteDialog } from "@pr0/ui/components/prompt-delete-dialog";
import { PromptHeader, PromptMeta } from "@pr0/ui/components/prompt-header";
import { RelativeTime } from "@pr0/ui/components/prompt-row";
import {
  EmptyDetail,
  LibraryWorkspace,
} from "@pr0/ui/components/wayfinder-shell";
import { accentFor } from "@pr0/ui/lib/present";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CollectionControls } from "./collection-controls";
import { LiveLibraryStatus } from "./live-library-status";
import { OrganizationAdjustments } from "./organization-adjustments";
import { PromptActionStatus } from "./prompt-action-status";
import { PromptConflicts } from "./prompt-conflicts";
import { PromptCopyStatus } from "./prompt-copy-status";
import { PromptEditor } from "./prompt-editor";
import { PromptExtraFilters } from "./prompt-extra-filters";
import { PromptResults, PromptViewNavigation } from "./prompt-results";
import { promptSaveNotice } from "./prompt-save-notice";
import {
  PromptSearchControls,
  PromptSortControl,
} from "./prompt-search-controls";
import { PromptTags } from "./prompt-tags";
import { PromptVariables } from "./prompt-variables";
import { QuickAccess, useQuickResults } from "./quick-access";
import { useCopyEligibility } from "./use-copy-eligibility";
import { useLibraryDrafts } from "./use-library-drafts";
import { useLibraryFilters } from "./use-library-filters";
import { useLibraryRefresh } from "./use-library-refresh";
import { useLibraryResults } from "./use-library-results";
import { useLiveChanges } from "./use-live-changes";
import { useOrganization } from "./use-organization";
import { usePromptActions } from "./use-prompt-actions";
import type { PromptAction } from "./use-prompt-actions";
import { usePromptCopy } from "./use-prompt-copy";
import { usePromptSearch } from "./use-prompt-search";
import type { usePromptSelection } from "./use-prompt-selection";

const buttonClass = "wf-btn";
const errorMessage = (error: Error) =>
  error instanceof PromptApiError
    ? error.message
    : "Could not load prompts. Try again.";
const lastUsedLabel = (prompt: Prompt) =>
  prompt.lastUsedAt ? (
    <>
      Last used <RelativeTime at={prompt.lastUsedAt} />
    </>
  ) : (
    "Not used yet"
  );
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
}) => {
  const prompt = detail.data;
  if (!prompt) {
    return (
      <section aria-labelledby="detail-heading" className="wf-article">
        <header className="wf-detail-head">
          <h2 className="wf-title" id="detail-heading">
            Prompt detail
          </h2>
          {detail.isPending ? (
            <output className="wf-hint">Loading prompt…</output>
          ) : null}
          {detail.isError ? (
            <div className="wf-notice" role="alert">
              <p>{errorMessage(detail.error)}</p>
              <button
                className={`${buttonClass} mt-2`}
                onClick={() => {
                  void detail.refetch();
                }}
                type="button"
              >
                Retry detail
              </button>
            </div>
          ) : null}
        </header>
      </section>
    );
  }
  const collection = collections.find(
    (entry) => entry.id === prompt.collectionId
  );
  const collectionName = collection?.name ?? "Unavailable";
  const { useCount: copies } = prompt;
  return (
    <section aria-labelledby="detail-heading" className="wf-article">
      <PromptHeader
        title={prompt.title}
        titleId="detail-heading"
        description={prompt.description}
        accent={accentFor(collection?.id)}
        collection={
          prompt.collectionId ? (
            <>
              <span className="sr-only">Collection: </span>
              {collectionName}
            </>
          ) : (
            "No collection"
          )
        }
        state={lastUsedLabel(prompt)}
        tags={prompt.tagIds.map(
          (id) => tags.find((tag) => tag.id === id)?.name ?? "Unavailable"
        )}
        tagAction={
          <button
            type="button"
            className="wf-btn-quiet"
            disabled={editing}
            onClick={() => onTags(prompt)}
          >
            Edit tags
          </button>
        }
      >
        <button
          className="wf-btn-accent"
          type="button"
          disabled={copy.blocked || editing}
          onClick={() => {
            void copy.copy(prompt.id);
          }}
        >
          Copy prompt
        </button>
        <kbd className="wf-kbd" title="With a result focused or from search">
          Ctrl ↵
        </kbd>
        <span className="wf-grow" />
        <button
          className={buttonClass}
          disabled={editing}
          onClick={() => onEdit(prompt)}
          type="button"
        >
          <Pencil aria-hidden="true" size={14} />
          Edit prompt
        </button>
        <PromptIconAction
          kind="favorite"
          label={prompt.favorite ? "Unfavorite prompt" : "Favorite prompt"}
          active={prompt.favorite}
          disabled={actionsBlocked}
          onClick={() => onAction(prompt, "favorite", !prompt.favorite)}
        />
        <PromptMoreActions label="More prompt actions">
          <button
            className="wf-menu-item"
            type="button"
            disabled={actionsBlocked}
            onClick={() => onAction(prompt, "duplicate")}
          >
            Duplicate prompt
          </button>
          <button
            className="wf-menu-item"
            type="button"
            disabled={actionsBlocked}
            onClick={() => onAction(prompt, "archived", !prompt.archived)}
          >
            {prompt.archived ? "Restore prompt" : "Archive prompt"}
          </button>
          <button
            className="wf-menu-item"
            type="button"
            disabled={actionsBlocked}
            onClick={() => onDelete(prompt)}
          >
            Permanently delete prompt
          </button>
        </PromptMoreActions>
      </PromptHeader>
      {detail.isError ? (
        <div className="wf-notices">
          <div className="wf-notice" role="alert">
            <p>{errorMessage(detail.error)}</p>
            <button
              className={`${buttonClass} mt-2`}
              onClick={() => {
                void detail.refetch();
              }}
              type="button"
            >
              Retry detail
            </button>
          </div>
        </div>
      ) : null}
      <PromptContent
        content={prompt.content}
        label="Saved content"
        spans={templateSpans(prompt.content)}
      />
      <PromptMeta>
        {prompt.sourceTitle &&
        prompt.title !== `${prompt.sourceTitle} (copy)` ? (
          <span>Original title: {prompt.sourceTitle}</span>
        ) : null}
        <span>
          Created{" "}
          <time dateTime={prompt.createdAt}>
            {new Date(prompt.createdAt).toLocaleString()}
          </time>
        </span>
        <span>
          Modified{" "}
          <time dateTime={prompt.modifiedAt}>
            {new Date(prompt.modifiedAt).toLocaleString()}
          </time>
        </span>
        <span>Copied {copies.toLocaleString()}×</span>
      </PromptMeta>
    </section>
  );
};
const nearingCapacity = (usage?: { promptCount: number; textBytes: number }) =>
  Boolean(
    usage &&
    (usage.promptCount >= promptLimits.promptCount * 0.9 ||
      usage.textBytes >= promptLimits.libraryBytes * 0.9)
  );
const LibraryCapacity = ({
  usage,
}: {
  usage?: { promptCount: number; textBytes: number };
}) => (
  <>
    {usage ? (
      <p>
        {usage.promptCount.toLocaleString()} / 10,000 prompts ·{" "}
        {(usage.textBytes / 1_048_576).toFixed(2)} / 100 MiB of text
      </p>
    ) : null}
    {nearingCapacity(usage) ? (
      <output className="wf-notice" data-tone="attention">
        Your library is at or above 90% capacity. Archiving does not free
        capacity.
      </output>
    ) : null}
  </>
);
const copyLibraryRevision = (
  data: { pages: { revision: string }[] } | undefined
) => data?.pages[0]?.revision;
const EditorSavedActions = ({
  copy,
  prompt,
  unavailable,
}: {
  copy: ReturnType<typeof usePromptCopy>;
  prompt: Prompt | "create";
  unavailable: boolean;
}) => (
  <>
    {prompt === "create" ? null : (
      <button
        type="button"
        disabled={copy.blocked || unavailable}
        className="wf-btn-quiet"
        onClick={() => {
          void copy.copy(prompt.id);
        }}
      >
        Copy saved prompt
      </button>
    )}
    <PromptCopyStatus copy={copy} />
  </>
);
const usePromptLibrary = ({
  library,
  onDirtyChange,
  accountAvailable = true,
  accountChanged = false,
  quickOpen = false,
  onQuickClose,
}: {
  quickOpen?: boolean;
  onQuickClose?: () => void;
  accountAvailable?: boolean;
  accountChanged?: boolean;
  library: PrivateLibrary;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const client = useApiClient();
  const live = useLiveChanges(library, accountAvailable && !accountChanged);
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
  const quick = useQuickResults(library, organization.data);
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
  const eligible = useCopyEligibility(
    quickOpen
      ? {
          accountAvailable,
          searchBlocked: quick.searchBlocked,
          ...quick.filters,
          query: quick.search.query,
          collections,
          tags,
          prompts: quick.prompts,
          selectedId: quick.selectedId,
        }
      : {
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
        }
  );
  const copy = usePromptCopy({
    library,
    accountChanged,
    libraryRevision: copyLibraryRevision(
      quickOpen ? quick.list.data : list.data
    ),
    onClipboardWritten: quickOpen ? onQuickClose : undefined,
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
  return {
    quick,
    live,
    deleting,
    setDeleting,
    actions,
    noticeRef,
    notice,
    editing,
    setEditing,
    setNotice,
    createRef,
    view,
    changeView,
    search,
    favorite,
    hasExtraFilters,
    setFilters,
    filters,
    restarted,
    tagIds,
    viewCollectionId,
    organization,
    accepted,
    collectionId,
    markDraft,
    copy,
    list,
    prompts,
    selectedId,
    setSelected,
    queryClient,
    queryKey,
    tagEditing,
    tags,
    setTagEditing,
    openPrompt,
    usage,
    collections,
    cancelEditor: () => {
      restoreFocus.current = true;
      setEditing(null);
    },
    saved,
    searchBlocked,
    detail,
    detailUnavailable,
  };
};

const LibrarySidebar = ({
  model,
  library,
}: {
  model: ReturnType<typeof usePromptLibrary>;
  library: PrivateLibrary;
}) => {
  const {
    noticeRef,
    notice,
    editing,
    setEditing,
    setNotice,
    createRef,
    view,
    changeView,
    search,
    favorite,
    hasExtraFilters,
    setFilters,
    filters,
    restarted,
    tagIds,
    viewCollectionId,
    organization,
    accepted,
    collectionId,
    markDraft,
    copy,
    list,
    prompts,
    selectedId,
    setSelected,
    actions,
    setDeleting,
    queryClient,
    queryKey,
  } = model;
  return (
    <>
      <div className="wf-sidebar-top">
        <PromptSearchControls search={search} />
        <PromptViewNavigation view={view} onChange={changeView} />
        <div className="wf-filter-row">
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
          <span className="wf-grow" />
          <PromptSortControl search={search} />
        </div>
        <p
          aria-live="polite"
          className="wf-notice empty:hidden"
          ref={noticeRef}
          tabIndex={-1}
        >
          {notice}
        </p>
        {restarted ? (
          <output className="wf-notice">
            Your library changed. Results restarted from the first page.
          </output>
        ) : null}
      </div>
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
      <PromptResults
        copy={copy}
        restricted={search.searching || hasExtraFilters}
        pendingSearch={search.pending || Boolean(search.error)}
        view={view}
        collectionId={viewCollectionId}
        list={list}
        prompts={prompts}
        collections={model.collections}
        tags={model.tags}
        selectedId={selectedId}
        setSelected={setSelected}
        actions={actions}
        onDelete={setDeleting}
        onRefresh={() => {
          void queryClient.resetQueries({ queryKey });
        }}
        headActions={
          <button
            className="wf-btn-quiet"
            disabled={Boolean(editing)}
            onClick={() => {
              setEditing("create");
              setNotice("");
            }}
            ref={createRef}
            type="button"
          >
            <Plus aria-hidden="true" size={13} />
            Create prompt
          </button>
        }
      />
    </>
  );
};

export const PromptLibrary = (
  props: Parameters<typeof usePromptLibrary>[0]
) => {
  const { library, quickOpen, onQuickClose } = props;
  const model = usePromptLibrary(props);
  const {
    quick,
    live,
    deleting,
    setDeleting,
    actions,
    editing,
    setEditing,
    setNotice,
    tagEditing,
    tags,
    setTagEditing,
    openPrompt,
    usage,
    collections,
    cancelEditor,
    saved,
    searchBlocked,
    detail,
    detailUnavailable,
    copy,
    selectedId,
    markDraft,
    accepted,
  } = model;
  return (
    <>
      <LiveLibraryStatus status={live}>
        <OrganizationAdjustments library={library} />
      </LiveLibraryStatus>
      {quickOpen && onQuickClose ? (
        <QuickAccess
          quick={quick}
          copy={copy}
          onClose={onQuickClose}
          onOpen={(id) => {
            onQuickClose();
            void openPrompt(id);
          }}
        />
      ) : (
        <PromptVariables copy={copy} />
      )}
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
      <LibraryWorkspace
        sidebar={<LibrarySidebar model={model} library={library} />}
      >
        <div className="wf-notices">
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
          <PromptConflicts
            library={library}
            onOpen={(id) => {
              void openPrompt(id);
            }}
          />
          {editing ? (
            <PromptEditor
              savedActions={
                <EditorSavedActions
                  copy={copy}
                  prompt={editing}
                  unavailable={searchBlocked || detailUnavailable}
                />
              }
              library={library}
              collections={collections}
              tags={tags}
              prompt={editing === "create" ? undefined : editing}
              onOpen={(id) => {
                void openPrompt(id);
              }}
              onCancel={cancelEditor}
              onDirtyChange={(dirty) => markDraft("editor", dirty)}
              onSaved={saved}
              onAccepted={accepted}
            />
          ) : null}
        </div>
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
        ) : (
          <EmptyDetail hint="Choose a prompt on the left, or open quick access with Ctrl K, type its name and press Enter." />
        )}
        <footer className="wf-meta">
          <LibraryCapacity usage={usage} />
        </footer>
        {editing || quickOpen ? null : (
          <div className="wf-toast">
            <PromptCopyStatus copy={copy} />
          </div>
        )}
      </LibraryWorkspace>
    </>
  );
};
