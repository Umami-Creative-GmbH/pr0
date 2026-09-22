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
import { Toast } from "@pr0/ui/components/toast";
import {
  EmptyDetail,
  LibraryWorkspace,
} from "@pr0/ui/components/wayfinder-shell";
import { useDeviceTimeZone } from "@pr0/ui/hooks/use-device-time-zone";
import { useLocale, useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
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
    : translate("couldNotLoadPromptsTryAgain");
const copiedMessage = translate("copiedUsageRecorded");
const lastUsedLabel = (prompt: Prompt) =>
  prompt.lastUsedAt ? (
    <>
      {translate("lastUsed")} <RelativeTime at={prompt.lastUsedAt} />
    </>
  ) : (
    translate("notUsedYet")
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
  const locale = useLocale();
  const timeZone = useDeviceTimeZone();

  const t = useTranslations();

  const prompt = detail.data;
  if (!prompt) {
    return (
      <section aria-labelledby="detail-heading" className="wf-article">
        <header className="wf-detail-head">
          <h2 className="wf-title" id="detail-heading">
            {t("promptDetail")}
          </h2>
          {detail.isPending ? (
            <output className="wf-hint">{t("loadingPrompt")}</output>
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
                {t("retryDetail")}
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
  const collectionName = collection?.name ?? t("unavailable");
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
              <span className="sr-only">{t("collection2")} </span>
              {collectionName}
            </>
          ) : (
            t("noCollection")
          )
        }
        state={lastUsedLabel(prompt)}
        tags={prompt.tagIds.map(
          (id) => tags.find((tag) => tag.id === id)?.name ?? t("unavailable")
        )}
        tagAction={
          <button
            type="button"
            className="wf-btn-quiet"
            disabled={editing}
            onClick={() => onTags(prompt)}
          >
            {t("editTags")}
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
          {t("copyPrompt")}
        </button>
        <kbd className="wf-kbd" title={t("withAResultFocusedOrFromSearch")}>
          {t("ctrl")}
        </kbd>
        <span className="wf-grow" />
        <button
          className={buttonClass}
          disabled={editing}
          onClick={() => onEdit(prompt)}
          type="button"
        >
          <Pencil aria-hidden="true" size={14} />
          {t("editPrompt")}
        </button>
        <PromptIconAction
          kind="favorite"
          label={t("favoritePrompt")}
          active={prompt.favorite}
          disabled={actionsBlocked}
          onClick={() => onAction(prompt, "favorite", !prompt.favorite)}
        />
        <PromptMoreActions label={t("morePromptActions")}>
          <button
            className="wf-menu-item"
            type="button"
            disabled={actionsBlocked}
            onClick={() => onAction(prompt, "duplicate")}
          >
            {t("duplicatePrompt")}
          </button>
          <button
            className="wf-menu-item"
            type="button"
            disabled={actionsBlocked}
            onClick={() => onAction(prompt, "archived", !prompt.archived)}
          >
            {prompt.archived ? t("restorePrompt") : t("archivePrompt")}
          </button>
          <button
            className="wf-menu-item"
            type="button"
            disabled={actionsBlocked}
            onClick={() => onDelete(prompt)}
          >
            {t("permanentlyDeletePrompt")}
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
              {t("retryDetail")}
            </button>
          </div>
        </div>
      ) : null}
      <PromptContent
        content={prompt.content}
        label={t("savedContent")}
        spans={templateSpans(prompt.content)}
      />
      <PromptMeta>
        {prompt.sourceTitle &&
        prompt.title !== `${prompt.sourceTitle} (copy)` ? (
          <span>
            {t("originalTitle")} {prompt.sourceTitle}
          </span>
        ) : null}
        <span>
          {t("created")}{" "}
          <time dateTime={prompt.createdAt}>
            {new Date(prompt.createdAt).toLocaleString(locale, { timeZone })}
          </time>
        </span>
        <span>
          {t("modified")}{" "}
          <time dateTime={prompt.modifiedAt}>
            {new Date(prompt.modifiedAt).toLocaleString(locale, { timeZone })}
          </time>
        </span>
        <span>
          {t("copied")} {copies.toLocaleString(locale)}×
        </span>
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
}) => {
  const locale = useLocale();

  const t = useTranslations();
  return (
    <>
      {usage ? (
        <p>
          {usage.promptCount.toLocaleString(locale)} {t("text10000Prompts")}{" "}
          {(usage.textBytes / 1_048_576).toLocaleString(locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          {t("text100MibOfText")}
        </p>
      ) : null}
      {nearingCapacity(usage) ? (
        <output className="wf-notice" data-tone="attention">
          {t("yourLibraryIsAtOrAbove90CapacityArchivingDoes")}
        </output>
      ) : null}
    </>
  );
};
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
}) => {
  const t = useTranslations();
  return (
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
          {t("copySavedPrompt")}
        </button>
      )}
      <PromptCopyStatus copy={copy} />
    </>
  );
};
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
  const t = useTranslations();

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
  const quick = useQuickResults(library, organization.data, quickOpen);
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
          ? t("valueUnseenTextWasPreservedInAConflictCopy", [message])
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
          : t("couldNotOpenThisPromptTryAgain")
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
  const t = useTranslations();

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
            {t("yourLibraryChangedResultsRestartedFromTheFirstPage")}
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
            {t("createPrompt")}
          </button>
        }
      />
    </>
  );
};

const LibraryDetail = ({
  model,
}: {
  model: ReturnType<typeof usePromptLibrary>;
}) => {
  const t = useTranslations();
  const {
    selectedId,
    searchBlocked,
    copy,
    detail,
    collections,
    editing,
    tagEditing,
    detailUnavailable,
    tags,
    setTagEditing,
    setEditing,
    setNotice,
    actions,
    setDeleting,
  } = model;
  return selectedId && !searchBlocked ? (
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
    <EmptyDetail hint={t("chooseAPromptOnTheLeftOrOpenQuickAccess")} />
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
    tagEditing,
    tags,
    setTagEditing,
    openPrompt,
    usage,
    collections,
    cancelEditor,
    saved,
    searchBlocked,
    detailUnavailable,
    copy,
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
        <LibraryDetail model={model} />
        <footer className="wf-meta">
          <LibraryCapacity usage={usage} />
        </footer>
        {editing || quickOpen ? null : (
          <Toast
            signal={`${copy.message}:${copy.busy}`}
            transient={
              copy.message === copiedMessage &&
              !copy.retryId &&
              !copy.usagePending
            }
          >
            <PromptCopyStatus copy={copy} />
          </Toast>
        )}
      </LibraryWorkspace>
    </>
  );
};
