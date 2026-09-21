"use client";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type {
  Collection,
  Tag,
  Prompt,
  MutationReceipt,
} from "@pr0/api-contract/prompts";
import { CollectionPicker } from "@pr0/ui/components/collection-picker";
import { PromptFields } from "@pr0/ui/components/prompt-fields";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import { WayfinderDialog } from "@pr0/ui/components/wayfinder-dialog";
import type { ReactNode } from "react";

import { collectionMatches } from "./collection-query";
import { PromptOriginal } from "./prompt-original";
import { usePromptEditor } from "./use-prompt-editor";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
export const PromptEditor = ({
  library,
  collections,
  tags,
  prompt,
  onSaved,
  onAccepted,
  onOpen,
  onCancel,
  onDirtyChange,
  savedActions,
}: {
  library: PrivateLibrary;
  collections: Collection[];
  tags: Tag[];
  prompt?: Prompt;
  onSaved: (receipt: MutationReceipt) => void;
  onAccepted: () => void | Promise<void>;
  onOpen: (id: string) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  savedActions: ReactNode;
}) => {
  const {
    tagIds,
    changeTags,
    draft,
    state,
    mappedOriginal,
    copyMessage,
    confirmDiscard,
    setConfirmDiscard,
    titleRef,
    statusRef,
    dirty,
    change,
    save,
    copy,
    discard,
    nearingFieldLimit,
    statusText,
  } = usePromptEditor({
    library,
    prompt,
    onSaved,
    onAccepted,
    onCancel,
    onDirtyChange,
  });
  const editorLabel = prompt ? "Edit prompt" : "Create prompt";
  return (
    <WayfinderDialog
      label={editorLabel}
      onRequestClose={() => {
        if (state.status === "saving") {
          return;
        }
        if (dirty || state.uncertain) {
          setConfirmDiscard(true);
        } else {
          discard();
        }
      }}
    >
      <section
        aria-labelledby="editor-heading"
        className="rounded-lg border p-6"
      >
        {savedActions}
        <h2 className="text-xl font-semibold" id="editor-heading">
          {editorLabel}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Only title and content are required. This draft stays in this open
          tab; closing or reloading the tab may lose it.
        </p>
        {mappedOriginal ? (
          <div className="my-3 rounded-md border p-3">
            <p>You&apos;re editing the conflict copy.</p>
            <PromptOriginal
              library={library}
              id={mappedOriginal}
              onOpen={onOpen}
            />
          </div>
        ) : null}
        {state.status === "draft" && state.message ? (
          <output>{state.message}</output>
        ) : null}
        <p aria-live="polite" className="my-3" ref={statusRef} tabIndex={-1}>
          {statusText}
        </p>
        {state.uncertain ? (
          <p className="mb-3 text-sm">
            Retry confirms the earlier Save with its original text. Any newer
            edits still need their own Save. Copy text remains available.
          </p>
        ) : null}
        {nearingFieldLimit ? (
          <p className="mb-3 text-sm">
            A prompt field is at or above 90% of its limit. Input is never
            truncated.
          </p>
        ) : null}
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <PromptFields
            errors={state.fields}
            onChange={change}
            readOnly={!prompt && (state.status === "saving" || state.uncertain)}
            titleRef={titleRef}
            value={draft}
          />
          <CollectionPicker
            collections={collections}
            label="Collection (optional)"
            emptyLabel="No collection"
            value={draft.collectionId}
            search={collectionMatches}
            disabled={!prompt && (state.status === "saving" || state.uncertain)}
            onChange={(collectionId) => change({ ...draft, collectionId })}
          />
          {state.fields.collectionId ? (
            <p role="alert">{state.fields.collectionId}</p>
          ) : null}
          {prompt ? null : (
            <TagPicker
              label="Tags (optional)"
              tags={tags}
              value={tagIds}
              onChange={changeTags}
              search={collectionMatches}
              disabled={state.status === "saving" || state.uncertain}
            />
          )}
          {tagIds.length > 20 ? (
            <p role="alert">Choose at most 20 tags.</p>
          ) : null}
          {state.fields.tagIds ? (
            <p role="alert">{state.fields.tagIds}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              className={buttonClass}
              disabled={state.status === "saving" || tagIds.length > 20}
              type="submit"
            >
              {state.status === "failed" ? "Retry" : "Save"}
            </button>
            <button
              className={buttonClass}
              onClick={() => {
                void copy();
              }}
              type="button"
            >
              Copy text
            </button>
            <button
              className={buttonClass}
              disabled={state.status === "saving"}
              onClick={() => {
                if (dirty || state.uncertain) {
                  setConfirmDiscard(true);
                } else {
                  discard();
                }
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
        {confirmDiscard ? (
          <section
            aria-label="Discard unsaved prompt"
            className="mt-4 rounded-md border p-3"
          >
            <p>
              {state.uncertain
                ? "Discard this open-tab draft? The server may already have saved this prompt. Retry first to confirm its outcome."
                : "Discard this unsaved prompt? Your draft will be lost."}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button className={buttonClass} onClick={discard} type="button">
                Discard draft
              </button>
              <button
                className={buttonClass}
                onClick={() => {
                  setConfirmDiscard(false);
                  titleRef.current?.focus();
                }}
                type="button"
              >
                Keep editing
              </button>
            </div>
          </section>
        ) : null}
        <p aria-live="polite" className="mt-3 text-sm">
          {copyMessage}
        </p>
      </section>
    </WayfinderDialog>
  );
};
