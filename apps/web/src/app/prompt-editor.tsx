"use client";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type {
  Collection,
  Tag,
  Prompt,
  MutationReceipt,
} from "@pr0/api-contract/prompts";
import { parseTemplate } from "@pr0/api-contract/variables";
import { CollectionPicker } from "@pr0/ui/components/collection-picker";
import { PromptFields } from "@pr0/ui/components/prompt-fields";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import {
  DialogHead,
  WayfinderDialog,
} from "@pr0/ui/components/wayfinder-dialog";
import { Braces } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { collectionMatches } from "./collection-query";
import { PromptOriginal } from "./prompt-original";
import { usePromptEditor } from "./use-prompt-editor";

const buttonClass = "wf-btn";
const variableHint = (content: string) => {
  const { fields } = parseTemplate(content);
  if (!fields.length) {
    return "{{variable}} is requested when copying";
  }
  const names = fields.map((field) => `{{${field.name}}}`).join(" ⦁ ");
  return `${names} ${fields.length === 1 ? "is" : "are"} requested when copying`;
};
const EditorFooter = ({
  content,
  saving,
  failed,
  saveDisabled,
  onCancel,
  onCopy,
}: {
  content: string;
  saving: boolean;
  failed: boolean;
  saveDisabled: boolean;
  onCancel: () => void;
  onCopy: () => void;
}) => (
  <footer className="wf-dialog-foot">
    <span className="flex items-center gap-2">
      <Braces aria-hidden="true" size={14} />
      {variableHint(content)}
    </span>
    <span className="wf-grow" />
    <button
      className={buttonClass}
      disabled={saving}
      onClick={onCancel}
      type="button"
    >
      Cancel
    </button>
    <button className={buttonClass} onClick={onCopy} type="button">
      Copy text
    </button>
    <button
      className="wf-btn-accent"
      disabled={saving || saveDisabled}
      type="submit"
    >
      {failed ? "Retry" : "Save"}
    </button>
  </footer>
);
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
  const [browsing, setBrowsing] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmDiscard && !browsing) {
      keepEditingRef.current?.focus();
    }
  }, [confirmDiscard, browsing]);
  const editorLabel = prompt ? "Edit prompt" : "Create prompt";
  const locked = !prompt && (state.status === "saving" || state.uncertain);
  const requestClose = () => {
    if (state.status === "saving") {
      return;
    }
    if (dirty || state.uncertain) {
      setConfirmDiscard(true);
    } else {
      discard();
    }
  };
  return (
    <>
      <button
        className="wf-btn-quiet"
        hidden={!browsing}
        type="button"
        onClick={() => setBrowsing(false)}
      >
        Resume prompt draft
      </button>
      <WayfinderDialog
        suspended={browsing}
        label={editorLabel}
        onRequestClose={requestClose}
      >
        {/* Journeys and assistive technology address the editor as a named region. */}
        <section aria-label={editorLabel} className="contents">
          <DialogHead
            eyebrow={prompt ? "Edit prompt" : "New prompt"}
            title={prompt ? draft.title || prompt.title : "Create prompt"}
            titleId="editor-heading"
            closeLabel="Close editor"
            closeDisabled={state.status === "saving"}
            onClose={requestClose}
          />
          <form
            aria-labelledby="editor-heading"
            className="flex min-h-0 flex-1 flex-col"
            noValidate
            onSubmit={(event) => {
              void save(event);
            }}
          >
            <div className="wf-dialog-body">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="wf-btn-quiet"
                  type="button"
                  onClick={() => setBrowsing(true)}
                >
                  Browse library (keep draft)
                </button>
                {savedActions}
              </div>
              <p className="wf-hint">
                Only title and content are required. This draft stays in this
                open tab; closing or reloading the tab may lose it.
              </p>
              {mappedOriginal ? (
                <div className="wf-notice">
                  <p>You&apos;re editing the conflict copy.</p>
                  <PromptOriginal
                    library={library}
                    id={mappedOriginal}
                    onOpen={(id) => {
                      onOpen(id);
                      setBrowsing(true);
                    }}
                  />
                </div>
              ) : null}
              {state.status === "draft" && state.message ? (
                <output className="wf-notice">{state.message}</output>
              ) : null}
              <p
                aria-live="polite"
                className="wf-notice empty:hidden"
                ref={statusRef}
                tabIndex={-1}
              >
                {statusText}
              </p>
              {state.uncertain ? (
                <p className="wf-hint">
                  Retry confirms the earlier Save with its original text. Any
                  newer edits still need their own Save. Copy text remains
                  available.
                </p>
              ) : null}
              {nearingFieldLimit ? (
                <p className="wf-hint">
                  A prompt field is at or above 90% of its limit. Input is never
                  truncated.
                </p>
              ) : null}
              <PromptFields
                errors={state.fields}
                onChange={change}
                readOnly={locked}
                titleRef={titleRef}
                value={draft}
              >
                <div className="wf-field-row">
                  <CollectionPicker
                    collections={collections}
                    label="Collection (optional)"
                    emptyLabel="No collection"
                    value={draft.collectionId}
                    search={collectionMatches}
                    disabled={locked}
                    onChange={(collectionId) =>
                      change({ ...draft, collectionId })
                    }
                  />
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
                </div>
                {state.fields.collectionId ? (
                  <p className="wf-error" role="alert">
                    {state.fields.collectionId}
                  </p>
                ) : null}
                {tagIds.length > 20 ? (
                  <p className="wf-error" role="alert">
                    Choose at most 20 tags.
                  </p>
                ) : null}
                {state.fields.tagIds ? (
                  <p className="wf-error" role="alert">
                    {state.fields.tagIds}
                  </p>
                ) : null}
              </PromptFields>
              {confirmDiscard ? (
                <section
                  aria-label="Discard unsaved prompt"
                  className="wf-notice"
                  data-tone="attention"
                >
                  <p id="discard-prompt-warning">
                    {state.uncertain
                      ? "Discard this open-tab draft? The server may already have saved this prompt. Retry first to confirm its outcome."
                      : "Discard this unsaved prompt? Your draft will be lost."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      className="wf-btn wf-btn-danger"
                      onClick={discard}
                      type="button"
                    >
                      Discard draft
                    </button>
                    <button
                      className={buttonClass}
                      ref={keepEditingRef}
                      aria-describedby="discard-prompt-warning"
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
              <p aria-live="polite" className="wf-hint empty:hidden">
                {copyMessage}
              </p>
            </div>
            <EditorFooter
              content={draft.content}
              saving={state.status === "saving"}
              failed={state.status === "failed"}
              saveDisabled={tagIds.length > 20}
              onCancel={requestClose}
              onCopy={() => {
                void copy();
              }}
            />
          </form>
        </section>
      </WayfinderDialog>
    </>
  );
};
