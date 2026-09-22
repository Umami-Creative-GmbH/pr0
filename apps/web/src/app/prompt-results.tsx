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
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
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
    : translate("couldNotLoadPromptsTryAgain");
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
}) => {
  const t = useTranslations();
  return (
    <PromptRow
      title={prompt.title}
      preview={prompt.description}
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
        label={t("copyValue", [prompt.title])}
        disabled={copy.blocked}
        onClick={() => {
          void copy.copy(prompt.id);
        }}
      />
      <PromptMoreActions
        size="sm"
        label={t("moreActionsForValue", [prompt.title])}
      >
        <button
          className={buttonClass}
          type="button"
          aria-label={t("duplicateValue", [prompt.title])}
          disabled={actions.blocked}
          onClick={() => {
            void actions.act(prompt, "duplicate");
          }}
        >
          {t("duplicate")}
        </button>
        <button
          className={buttonClass}
          type="button"
          aria-label={`${prompt.archived ? t("restore") : t("archive")} ${prompt.title}`}
          disabled={actions.blocked}
          onClick={() => {
            void actions.act(prompt, "archived", !prompt.archived);
          }}
        >
          {prompt.archived ? t("restore") : t("archive")}
        </button>
        <button
          className={buttonClass}
          type="button"
          aria-label={t("permanentlyDeleteValue", [prompt.title])}
          disabled={actions.blocked}
          onClick={() => onDelete(prompt)}
        >
          {t("delete")}
        </button>
      </PromptMoreActions>
      <PromptIconAction
        kind="favorite"
        size="sm"
        label={`${prompt.favorite ? t("unfavorite") : t("favorite")} ${prompt.title}`}
        active={prompt.favorite}
        disabled={actions.blocked}
        onClick={() => {
          void actions.act(prompt, "favorite", !prompt.favorite);
        }}
      />
    </PromptRow>
  );
};
const emptyViewMessage = (view: PromptView) => {
  if (view === "recents") {
    return translate("noRecentPromptsSuccessfullyCopyAPromptToSeeIt");
  }
  return view === "all"
    ? translate("noActivePromptsCreateAPromptOrOpenTheArchive")
    : translate("noPromptsInValue", [
        view === "archive" ? translate("theArchive") : "favorites",
      ]);
};
const resultsHeading = (
  empty: boolean,
  restricted: boolean,
  view: PromptView,
  count?: number
) =>
  empty && !restricted && view === "all" && count === 0
    ? translate("yourLibraryIsEmpty")
    : translate("savedPrompts");
const ResultsProgress = ({
  list,
}: {
  list: UseInfiniteQueryResult<
    InfiniteData<z.infer<typeof promptPageSchema>>,
    Error
  >;
}) => {
  const t = useTranslations();
  return (
    <>
      {list.isPending ? (
        <output className="wf-hint px-2">{t("loadingYourLibrary")}</output>
      ) : null}
      {list.failureReason instanceof PromptApiError &&
      list.failureReason.detail?.code === "search_preparing" ? (
        <output className="wf-hint px-2">
          {t("searchIsPreparingYourLatestLibrary")}
        </output>
      ) : null}
    </>
  );
};
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
  const t = useTranslations();

  let emptyMessage = emptyViewMessage(view);
  if (collectionId) {
    emptyMessage = t("thisCollectionIsEmptyCreateAPromptOrChooseAnother");
  }
  if (restricted) {
    emptyMessage = t("noMatchingPrompts");
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
          {shown ? t("valuePromptsShown", [prompts.length]) : ""}
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
              {t("refreshList")}
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
            {list.isFetchingNextPage ? t("loading2") : t("loadMorePrompts")}
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
}) => {
  const t = useTranslations();
  return (
    <nav aria-label={t("promptViews")} className="wf-segment">
      {(
        [
          ["all", t("allPrompts")],
          ["favorites", t("favorites")],
          ["recents", t("recents")],
          ["archive", t("archive")],
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
};
