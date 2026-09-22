import type {
  LifecycleAction,
  LocalPrompt,
} from "@pr0/api-contract/local-prompts";
import { templateSpans } from "@pr0/api-contract/variables";
import {
  PromptMoreActions,
  PromptIconAction,
} from "@pr0/ui/components/prompt-actions";
import { PromptContent } from "@pr0/ui/components/prompt-content";
import { PromptHeader, PromptMeta } from "@pr0/ui/components/prompt-header";
import { useLocale, useTranslations } from "@pr0/ui/hooks/use-translations";
import { accentFor } from "@pr0/ui/lib/present";
import { Pencil } from "lucide-react";

import { LifecycleActions } from "./lifecycle-actions";

export const LocalPromptDetail = ({
  value,
  editing,
  onEdit,
  onCopy,
  copying,
  onAction,
  collection,
  tags,
}: {
  value: LocalPrompt;
  editing: boolean;
  onEdit: () => void;
  onCopy: () => void;
  copying: boolean;
  onAction: (value: LocalPrompt, action: LifecycleAction) => void;
  /** Resolved organization names, when the snapshot is available. */
  collection?: string;
  tags?: string[];
}) => {
  const locale = useLocale();

  const t = useTranslations();

  const { prompt } = value;
  return (
    <article aria-label={t("promptDetail")} className="wf-article">
      <PromptHeader
        title={prompt.title}
        headingLevel={3}
        description={prompt.description}
        accent={accentFor(prompt.collectionId)}
        collection={collection ?? t("noCollection")}
        state={value.pending ? t("savedOnThisDevice") : t("savedToServer2")}
        tags={tags}
      >
        <button
          className="wf-btn-accent"
          type="button"
          disabled={copying}
          onClick={onCopy}
        >
          {t("copyPrompt")}
        </button>
        <kbd className="wf-kbd" title={t("withAResultFocusedOrFromSearch")}>
          {t("ctrl")}
        </kbd>
        <span className="wf-grow" />
        <button
          className="wf-btn"
          type="button"
          disabled={editing}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" size={14} />
          {t("editPrompt")}
        </button>
        <PromptIconAction
          kind="favorite"
          label={t("favoritePrompt")}
          active={prompt.favorite}
          disabled={editing}
          onClick={() =>
            onAction(value, { kind: "favorite", value: !prompt.favorite })
          }
        />
        <PromptMoreActions label={t("morePromptActions")}>
          <LifecycleActions
            value={value}
            disabled={editing}
            onAction={onAction}
          />
        </PromptMoreActions>
      </PromptHeader>
      <PromptContent
        label={t("promptContent")}
        content={prompt.content}
        spans={templateSpans(prompt.content)}
      />
      <PromptMeta>
        {prompt.sourceTitle ? (
          <span className="break-words whitespace-pre-wrap">
            {t("fullSourceTitle")} {prompt.sourceTitle}
          </span>
        ) : null}
        {value.pending ? <span>{t("changesWaitingToSync")}</span> : null}
        {value.pending ? (
          <span>{t("datesAreProvisionalUntilServerAcceptance")}</span>
        ) : null}
        <span>
          {t("modified2")}{" "}
          <time dateTime={prompt.modifiedAt}>
            {new Date(prompt.modifiedAt).toLocaleString(locale)}
          </time>
        </span>
      </PromptMeta>
    </article>
  );
};
