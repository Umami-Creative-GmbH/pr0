import type {
  LifecycleAction,
  LocalPrompt,
} from "@pr0/api-contract/local-prompts";
import {
  PromptMoreActions,
  PromptIconAction,
} from "@pr0/ui/components/prompt-actions";
import { PromptContent } from "@pr0/ui/components/prompt-content";

import { LifecycleActions } from "./lifecycle-actions";

export const LocalPromptDetail = ({
  value,
  editing,
  onEdit,
  onCopy,
  copying,
  onAction,
}: {
  value: LocalPrompt;
  editing: boolean;
  onEdit: () => void;
  onCopy: () => void;
  copying: boolean;
  onAction: (value: LocalPrompt, action: LifecycleAction) => void;
}) => {
  const { prompt } = value;
  return (
    <article
      aria-label="Prompt detail"
      className="space-y-3 rounded border p-4"
    >
      <h3 className="text-lg font-semibold">{prompt.title}</h3>
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded border px-3 py-2 disabled:opacity-50"
          type="button"
          disabled={editing}
          onClick={onEdit}
        >
          Edit prompt
        </button>
        <button
          className="wf-primary"
          type="button"
          disabled={copying}
          onClick={onCopy}
        >
          Copy prompt
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
      </div>
      {prompt.description ? (
        <p className="whitespace-pre-wrap">{prompt.description}</p>
      ) : null}
      <PromptContent label="Prompt content" content={prompt.content} />
      {value.pending ? (
        <>
          <p>Saved on this device</p>
          <p>Changes waiting to sync</p>
          <p>Dates are provisional until server acceptance.</p>
        </>
      ) : (
        <p>Saved to server</p>
      )}
      <p>
        Modified:{" "}
        <time dateTime={prompt.modifiedAt}>
          {new Date(prompt.modifiedAt).toLocaleString()}
        </time>
      </p>
    </article>
  );
};
