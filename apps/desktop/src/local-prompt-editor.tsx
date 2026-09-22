import type {
  LocalPrompt,
  LocalSave,
  UploadStatus,
} from "@pr0/api-contract/local-prompts";
import type { PromptText } from "@pr0/api-contract/prompts";
import { parseTemplate } from "@pr0/api-contract/variables";
import { EditorFooter } from "@pr0/ui/components/editor-footer";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import {
  DialogHead,
  WayfinderDialog,
} from "@pr0/ui/components/wayfinder-dialog";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

import { libraryClient } from "./library-client";
import { useResidentEditor } from "./resident-editor";
import type { Status } from "./use-auth-session";

const failures = {
  disk_full: translate("thisDeviceIsOutOfStorageSpaceFreeSpaceAnd"),
  storage_busy: translate("anotherWriteIsUsingTheLibraryRetryShortly"),
  storage_unavailable: translate(
    "theDeviceCouldNotSaveThisDraftCheckStorageAccess"
  ),
  commit_uncertain: translate("theSaveCouldNotBeConfirmedRetryToCheckThe"),
  local_revision_conflict: translate(
    "theLibraryChangedInAnotherWindowOrDownloadYourDraft"
  ),
  save_superseded: translate("thisSaveWasCommittedButANewerSavedEditNow"),
  quota_exceeded: translate(
    "theLibraryHasReachedItsPromptOrTextCapacityReduce"
  ),
  operation_cancelled: translate(
    "theAccountSessionChangedYourDraftIsRetainedRetryIn"
  ),
  validation_title: translate("enterATitleOfAtMost200UnicodeCodePoints"),
  validation_description: translate(
    "descriptionMustBeAtMost2000UnicodeCodePoints"
  ),
  validation_content: translate("enterNonblankContentOfAtMost256KibOfUtf"),
  validation_unicode: translate("useValidUnicodeTextWithoutNulCharacters"),
} satisfies Record<string, string>;
const failureMessages = new Map(Object.entries(failures));

const PromptFields = ({
  draft,
  change,
}: {
  draft: PromptText;
  change: (field: keyof PromptText, value: string) => void;
}) => {
  const t = useTranslations();
  return (
    <>
      <div className="wf-field">
        <label className="wf-label" htmlFor="draft-title">
          {t("title")}
        </label>
        <input
          id="draft-title"
          placeholder={t("eGWebsiteAccessibilityAudit")}
          value={draft.title}
          onChange={(event) => change("title", event.target.value)}
        />
      </div>
      <div className="wf-field">
        <label className="wf-label" htmlFor="draft-description">
          {t("description")}
        </label>
        <textarea
          className="font-sans"
          id="draft-description"
          placeholder={t("oneSentenceOnWhatThisPromptIsGoodFor")}
          rows={2}
          value={draft.description}
          onChange={(event) => change("description", event.target.value)}
        />
      </div>
      <div className="wf-field">
        <label className="wf-label" htmlFor="draft-content">
          {t("content")}
        </label>
        <textarea
          data-size="lg"
          id="draft-content"
          rows={10}
          value={draft.content}
          onChange={(event) => change("content", event.target.value)}
        />
      </div>
    </>
  );
};

const DiscardConfirmation = ({
  saving,
  onCancel,
  onKeep,
}: {
  saving: boolean;
  onCancel: () => void;
  onKeep: () => void;
}) => {
  const t = useTranslations();
  return (
    <section
      aria-label={t("discardDraftConfirmation")}
      className="wf-notice"
      data-tone="attention"
    >
      <p>{t("discardThisUnsavedDraftItsTextWillBeLost")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          className="wf-btn wf-btn-danger"
          type="button"
          disabled={saving}
          onClick={onCancel}
        >
          {t("discardDraft")}
        </button>
        <button className="wf-btn" type="button" onClick={onKeep}>
          {t("keepEditing")}
        </button>
      </div>
    </section>
  );
};

const EditorSaveStatus = ({
  saving,
  saveError,
}: {
  saving: boolean;
  saveError: string;
}) => {
  const t = useTranslations();
  return (
    <>
      <p aria-live="polite" className="wf-notice">
        {saving ? t("saving") : ""}
        {!saving && saveError ? t("notSaved2") : ""}
        {!saving && !saveError ? t("unsavedChanges") : ""}
      </p>
      {saveError ? (
        <p className="wf-notice" role="alert">
          {saveError}
        </p>
      ) : null}
    </>
  );
};

/** Ways out to the library that keep the mounted draft. */
const EditorContext = ({
  redirected,
  onBrowse,
  onOpenOriginal,
}: {
  redirected: boolean;
  onBrowse: () => void;
  onOpenOriginal?: () => void;
}) => {
  const t = useTranslations();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button className="wf-btn-quiet" type="button" onClick={onBrowse}>
          {t("browseLibraryKeepDraft")}
        </button>
        {onOpenOriginal ? (
          <button
            className="wf-btn-quiet"
            type="button"
            onClick={onOpenOriginal}
          >
            {t("openOriginal")}
          </button>
        ) : null}
      </div>
      {redirected ? (
        <p className="wf-notice">
          {t("youAposReEditingTheConflictCopyYourUnsavedText")}
        </p>
      ) : null}
    </>
  );
};

export const LocalPromptEditor = ({
  initial,
  mappings,
  account,
  onSaved,
  onCancel,
  onOpenOriginal,
  onSaveFailure,
}: {
  initial?: LocalPrompt;
  mappings?: UploadStatus["mappings"];
  account: Status;
  onSaved: (value: LocalPrompt) => void;
  onCancel: () => void;
  onOpenOriginal: (id: string) => void;
  onSaveFailure?: (failed: boolean) => void;
}) => {
  const t = useTranslations();

  const [draft, setDraft] = useState<PromptText>(() => ({
    title: initial?.prompt.title ?? "",
    description: initial?.prompt.description ?? "",
    content: initial?.prompt.content ?? "",
  }));
  const currentDraft = useRef(draft);
  const savedDraft = useRef(draft);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const target = useRef({
    id: initial?.prompt.id ?? crypto.randomUUID(),
    revision: initial?.localRevision ?? null,
  });
  const attempt = useRef<LocalSave | null>(null);
  const existingMappings = useRef<Set<string> | null>(null);
  if (existingMappings.current === null) {
    existingMappings.current = new Set(mappings?.map((entry) => entry.copyId));
  }
  const [redirected, setRedirected] = useState(false);
  const [originalId, setOriginalId] = useState<string>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const mapping = mappings?.find(
      (entry) =>
        entry.originalId === target.current.id &&
        !existingMappings.current?.has(entry.copyId)
    );
    if (!mapping || saving) {
      return;
    }
    let cancelled = false;
    const redirect = async () => {
      try {
        const current = await libraryClient.editor(mapping.copyId);
        if (!cancelled && !attempt.current) {
          target.current = {
            id: current.prompt.id,
            revision: current.localRevision,
          };
          existingMappings.current?.add(mapping.copyId);
          setRedirected(true);
          try {
            await libraryClient.detail(mapping.originalId);
            if (!cancelled) {
              setOriginalId(mapping.originalId);
            }
          } catch {
            // A deleted or unavailable original has no Open action.
          }
        }
      } catch {
        // A later invalidation retries identity resolution; the draft remains untouched.
      }
    };
    void redirect();
    return () => {
      cancelled = true;
    };
  }, [mappings, saving]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [discard, setDiscard] = useState(false);
  const makeRequest = (): LocalSave => ({
    instanceId: account.instanceId ?? "",
    accountId: account.accountId ?? "",
    generation: account.generation,
    operationId: crypto.randomUUID(),
    promptId: target.current.id,
    expectedLocalRevision: target.current.revision,
    desired: currentDraft.current,
  });
  const change = (field: keyof PromptText, value: string) => {
    const next = { ...currentDraft.current, [field]: value };
    currentDraft.current = next;
    setDraft(next);
    setCopyMessage("");
  };
  const performSave = async (): Promise<boolean> => {
    let saved = false;
    setSaving(true);
    setSaveError("");
    onSaveFailure?.(false);
    setConflict(false);
    const request = attempt.current ?? makeRequest();
    attempt.current = request;
    try {
      const result = await libraryClient.save({
        ...request,
        generation: account.generation,
      });
      target.current = { id: result.prompt.id, revision: result.localRevision };
      attempt.current = null;
      savedDraft.current = request.desired;
      // Inputs remain editable during a native save. Its acknowledgement certifies only that submitted variant.
      if (
        active.current &&
        JSON.stringify(currentDraft.current) === JSON.stringify(request.desired)
      ) {
        saved = true;
        onSaved(result);
      }
    } catch (error) {
      onSaveFailure?.(true);
      if (error instanceof z.ZodError) {
        setSaveError(error.issues.map((issue) => issue.message).join(" "));
        attempt.current = null;
      } else {
        const parsed = z.string().safeParse(error);
        const code = parsed.success ? parsed.data : "commit_uncertain";
        setSaveError(
          failureMessages.get(code) ??
            t("theSaveCouldNotBeConfirmedKeepThisDraftOpen")
        );
        setConflict(
          code === "local_revision_conflict" || code === "save_superseded"
        );
        // Only definite refusals permit correcting a request. Uncertain commits must replay the frozen identity first.
        if (
          [
            "disk_full",
            "storage_busy",
            "quota_exceeded",
            "local_revision_conflict",
            "save_superseded",
            "operation_cancelled",
            "validation_title",
            "validation_content",
            "validation_description",
            "validation_unicode",
          ].includes(code)
        ) {
          attempt.current = null;
        }
      }
    }
    setSaving(false);
    return saved;
  };
  const save = async (): Promise<boolean> => {
    if (pendingSave.current) {
      return await pendingSave.current;
    }
    pendingSave.current = performSave();
    try {
      const result = await pendingSave.current;
      pendingSave.current = null;
      return result;
    } catch {
      pendingSave.current = null;
      setSaving(false);
      setSaveError(t("theSaveCouldNotBeConfirmedKeepThisDraftOpen"));
      return false;
    }
  };
  useResidentEditor({
    hasChanges: () =>
      Boolean(attempt.current) ||
      JSON.stringify(currentDraft.current) !==
        JSON.stringify(savedDraft.current),
    pending: () => pendingSave.current,
    save,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };
  const copy = async () => {
    try {
      await libraryClient.copyDraft(makeRequest());
      setCopyMessage(t("textCopied"));
    } catch {
      setCopyMessage(t("copyFailedYourTextIsStillAvailableSelectItAnd"));
    }
  };
  const [browsing, setBrowsing] = useState(false);
  const editorLabel = initial ? t("editPrompt") : t("newPrompt");
  const requestClose = () => {
    if (!saving) {
      setDiscard(true);
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
        <DialogHead
          eyebrow={editorLabel}
          title={
            initial ? draft.title || initial.prompt.title : t("createAPrompt")
          }
          closeLabel="Close editor"
          closeDisabled={saving}
          onClose={requestClose}
        />
        <form
          aria-label={t("promptEditor")}
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={submit}
        >
          <div className="wf-dialog-body">
            <EditorContext
              redirected={redirected}
              onBrowse={() => setBrowsing(true)}
              onOpenOriginal={
                originalId
                  ? () => {
                      onOpenOriginal(originalId);
                      setBrowsing(true);
                    }
                  : undefined
              }
            />
            <h3 className="sr-only">{editorLabel}</h3>
            <PromptFields draft={draft} change={change} />
            <EditorSaveStatus saving={saving} saveError={saveError} />
            <p aria-live="polite" className="wf-hint empty:hidden">
              <LocalizedMessage value={copyMessage} />
            </p>
            {discard ? (
              <DiscardConfirmation
                saving={saving}
                onCancel={onCancel}
                onKeep={() => setDiscard(false)}
              />
            ) : null}
          </div>
          <EditorFooter
            variableNames={parseTemplate(draft.content).fields.map(
              (field) => field.name
            )}
            saving={saving}
            retry={Boolean(saveError)}
            onCancel={() => setDiscard(true)}
            onCopy={() => {
              void copy();
            }}
            onSaveAsNew={
              conflict
                ? () => {
                    target.current = {
                      id: crypto.randomUUID(),
                      revision: null,
                    };
                    attempt.current = null;
                    void save();
                  }
                : undefined
            }
          />
        </form>
      </WayfinderDialog>
    </>
  );
};
