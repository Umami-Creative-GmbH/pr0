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
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { PromptFields } from "@pr0/ui/components/prompt-fields";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import {
  DialogHead,
  WayfinderDialog,
} from "@pr0/ui/components/wayfinder-dialog";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
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
>) => {
  const t = useTranslations();
  return (
    <>
      {state.status === "draft" && state.message ? (
        <output className="wf-notice">
          <LocalizedMessage value={state.message} />
        </output>
      ) : null}
      <p
        aria-live="polite"
        className="wf-notice empty:hidden"
        ref={statusRef}
        tabIndex={-1}
      >
        <LocalizedMessage value={statusText} />
      </p>
      {state.uncertain ? (
        <p className="wf-hint">
          {t("retryConfirmsTheEarlierSaveWithItsOriginalTextAny")}
        </p>
      ) : null}
      {nearingFieldLimit ? (
        <p className="wf-hint">{t("aPromptFieldIsAtOrAbove90OfIts")}</p>
      ) : null}
    </>
  );
};

const OrganizationErrors = ({
  fields,
  tagCount,
}: {
  fields: Editor["state"]["fields"];
  tagCount: number;
}) => {
  const t = useTranslations();
  return (
    <>
      {fields.collectionId ? (
        <p className="wf-error" role="alert">
          <LocalizedMessage value={fields.collectionId} />
        </p>
      ) : null}
      {tagCount > 20 ? (
        <p className="wf-error" role="alert">
          {t("chooseAtMost20Tags")}
        </p>
      ) : null}
      {fields.tagIds ? (
        <p className="wf-error" role="alert">
          <LocalizedMessage value={fields.tagIds} />
        </p>
      ) : null}
    </>
  );
};

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
  const t = useTranslations();

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
  const editorLabel = prompt ? t("editPrompt") : t("createPrompt");
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
        {t("resumePromptDraft")}
      </button>
      <WayfinderDialog
        suspended={browsing}
        label={editorLabel}
        onRequestClose={requestClose}
      >
        {/* Journeys and assistive technology address the editor as a named region. */}
        <section aria-label={editorLabel} className="contents">
          <DialogHead
            eyebrow={prompt ? t("editPrompt") : t("newPrompt")}
            title={prompt ? draft.title || prompt.title : t("createPrompt")}
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
                  {t("browseLibraryKeepDraft")}
                </button>
                {savedActions}
              </div>
              <p className="wf-hint">
                {t("onlyTitleAndContentAreRequiredThisDraftStaysIn")}
              </p>
              {mappedOriginal ? (
                <div className="wf-notice">
                  <p>{t("youAposReEditingTheConflictCopy")}</p>
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
                    label={t("collectionOptional")}
                    emptyLabel={t("noCollection")}
                    value={draft.collectionId}
                    search={collectionMatches}
                    disabled={locked}
                    onChange={(collectionId) =>
                      change({ ...draft, collectionId })
                    }
                  />
                  {prompt ? null : (
                    <TagPicker
                      label={t("tagsOptional")}
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
                  aria-label={t("discardUnsavedPrompt")}
                  className="wf-notice"
                  data-tone="attention"
                >
                  <p id="discard-prompt-warning">
                    {state.uncertain
                      ? t("discardThisOpenTabDraftTheServerMayAlreadyHave")
                      : t("discardThisUnsavedPromptYourDraftWillBeLost")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      className="wf-btn wf-btn-danger"
                      onClick={discard}
                      type="button"
                    >
                      {t("discardDraft")}
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
                      {t("keepEditing")}
                    </button>
                  </div>
                </section>
              ) : null}
              <p aria-live="polite" className="wf-hint empty:hidden">
                <LocalizedMessage value={copyMessage} />
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
