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
import { EditorFooter } from "@pr0/ui/components/editor-footer";
import { PromptFields } from "@pr0/ui/components/prompt-fields";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import {
  DialogHead,
  WayfinderDialog,
} from "@pr0/ui/components/wayfinder-dialog";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { collectionMatches } from "./collection-query";
import { PromptOriginal } from "./prompt-original";
import { usePromptEditor } from "./use-prompt-editor";

const buttonClass = "wf-btn";
type Editor = ReturnType<typeof usePromptEditor>;

const EditorNotices = ({
  state,
  statusRef,
  statusText,
  nearingFieldLimit,
}: Pick<
  Editor,
  "state" | "statusRef" | "statusText" | "nearingFieldLimit"
>) => (
  <>
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
        Retry confirms the earlier Save with its original text. Any newer edits
        still need their own Save. Copy text remains available.
      </p>
    ) : null}
    {nearingFieldLimit ? (
      <p className="wf-hint">
        A prompt field is at or above 90% of its limit. Input is never
        truncated.
      </p>
    ) : null}
  </>
);

const OrganizationErrors = ({
  fields,
  tagCount,
}: {
  fields: Editor["state"]["fields"];
  tagCount: number;
}) => (
  <>
    {fields.collectionId ? (
      <p className="wf-error" role="alert">
        {fields.collectionId}
      </p>
    ) : null}
    {tagCount > 20 ? (
      <p className="wf-error" role="alert">
        Choose at most 20 tags.
      </p>
    ) : null}
    {fields.tagIds ? (
      <p className="wf-error" role="alert">
        {fields.tagIds}
      </p>
    ) : null}
  </>
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
              <EditorNotices
                state={state}
                statusRef={statusRef}
                statusText={statusText}
                nearingFieldLimit={nearingFieldLimit}
              />
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
                <OrganizationErrors
                  fields={state.fields}
                  tagCount={tagIds.length}
                />
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
              variableNames={parseTemplate(draft.content).fields.map(
                (field) => field.name
              )}
              saving={state.status === "saving"}
              retry={state.status === "failed"}
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
