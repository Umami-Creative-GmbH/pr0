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
  const { prompt } = value;
  return (
    <article aria-label="Prompt detail" className="wf-article">
      <PromptHeader
        title={prompt.title}
        headingLevel={3}
        description={prompt.description}
        accent={accentFor(prompt.collectionId)}
        collection={collection ?? "No collection"}
        state={value.pending ? "Saved on this device" : "Saved to server"}
        tags={tags}
      >
        <button
          className="wf-btn-accent"
          type="button"
          disabled={copying}
          onClick={onCopy}
        >
          Copy prompt
        </button>
        <kbd className="wf-kbd" title="With a result focused or from search">
          Ctrl ↵
        </kbd>
        <span className="wf-grow" />
        <button
          className="wf-btn"
          type="button"
          disabled={editing}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" size={14} />
          Edit prompt
        </button>
        <PromptIconAction
          kind="favorite"
          label="Favorite prompt"
          active={prompt.favorite}
          disabled={editing}
          onClick={() =>
            onAction(value, { kind: "favorite", value: !prompt.favorite })
          }
        />
        <PromptMoreActions label="More prompt actions">
          <LifecycleActions
            value={value}
            disabled={editing}
            onAction={onAction}
          />
        </PromptMoreActions>
      </PromptHeader>
      <PromptContent
        label="Prompt content"
        content={prompt.content}
        spans={templateSpans(prompt.content)}
      />
      <PromptMeta>
        {prompt.sourceTitle ? (
          <span className="break-words whitespace-pre-wrap">
            Full source title: {prompt.sourceTitle}
          </span>
        ) : null}
        {value.pending ? <span>Changes waiting to sync</span> : null}
        {value.pending ? (
          <span>Dates are provisional until server acceptance.</span>
        ) : null}
        <span>
          Modified:{" "}
          <time dateTime={prompt.modifiedAt}>
            {new Date(prompt.modifiedAt).toLocaleString()}
          </time>
        </span>
      </PromptMeta>
    </article>
  );
};
