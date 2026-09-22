import type {
  LocalPrompt,
  LocalSave,
  UploadStatus,
} from "@pr0/api-contract/local-prompts";
import type { PromptText } from "@pr0/api-contract/prompts";
import { parseTemplate } from "@pr0/api-contract/variables";
import {
  DialogHead,
  WayfinderDialog,
} from "@pr0/ui/components/wayfinder-dialog";
import { Braces } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

import { libraryClient } from "./library-client";
import { useResidentEditor } from "./resident-editor";
import type { Status } from "./use-auth-session";

const failures = {
  disk_full:
    "This device is out of storage space. Free space and retry. Your draft remains here until you close it.",
  storage_busy: "Another write is using the library. Retry shortly.",
  storage_unavailable:
    "The device could not save this draft. Check storage access and free space, then retry.",
  commit_uncertain:
    "The save could not be confirmed. Retry to check the same save safely.",
  local_revision_conflict:
    "The library changed in another window or download. Your draft is retained. Copy it or save it as a new prompt.",
  save_superseded:
    "This save was committed, but a newer saved edit now exists. Your draft is retained. Copy it or save it as a new prompt.",
  quota_exceeded:
    "The library has reached its prompt or text capacity. Reduce the text or free capacity, then retry. Archiving does not free capacity.",
  operation_cancelled:
    "The account session changed. Your draft is retained. Retry in the same account.",
  validation_title: "Enter a title of at most 200 Unicode code points.",
  validation_description:
    "Description must be at most 2,000 Unicode code points.",
  validation_content:
    "Enter nonblank content of at most 256 KiB of UTF-8 text.",
  validation_unicode: "Use valid Unicode text without NUL characters.",
} satisfies Record<string, string>;
const failureMessages = new Map(Object.entries(failures));

const PromptFields = ({
  draft,
  change,
}: {
  draft: PromptText;
  change: (field: keyof PromptText, value: string) => void;
}) => (
  <>
    <div className="wf-field">
      <label className="wf-label" htmlFor="draft-title">
        Title
      </label>
      <input
        id="draft-title"
        placeholder="e.g. Website accessibility audit"
        value={draft.title}
        onChange={(event) => change("title", event.target.value)}
      />
    </div>
    <div className="wf-field">
      <label className="wf-label" htmlFor="draft-description">
        Description
      </label>
      <textarea
        className="font-sans"
        id="draft-description"
        placeholder="One sentence on what this prompt is good for"
        rows={2}
        value={draft.description}
        onChange={(event) => change("description", event.target.value)}
      />
    </div>
    <div className="wf-field">
      <label className="wf-label" htmlFor="draft-content">
        Content
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

const DiscardConfirmation = ({
  saving,
  onCancel,
  onKeep,
}: {
  saving: boolean;
  onCancel: () => void;
  onKeep: () => void;
}) => (
  <section
    aria-label="Discard draft confirmation"
    className="wf-notice"
    data-tone="attention"
  >
    <p>Discard this unsaved draft? Its text will be lost.</p>
    <div className="mt-3 flex flex-wrap gap-3">
      <button
        className="wf-btn wf-btn-danger"
        type="button"
        disabled={saving}
        onClick={onCancel}
      >
        Discard draft
      </button>
      <button className="wf-btn" type="button" onClick={onKeep}>
        Keep editing
      </button>
    </div>
  </section>
);

const EditorSaveStatus = ({
  saving,
  saveError,
}: {
  saving: boolean;
  saveError: string;
}) => (
  <>
    <p aria-live="polite" className="wf-notice">
      {saving ? "Saving…" : ""}
      {!saving && saveError ? "Not saved" : ""}
      {!saving && !saveError ? "Unsaved changes" : ""}
    </p>
    {saveError ? (
      <p className="wf-notice" role="alert">
        {saveError}
      </p>
    ) : null}
  </>
);

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
  retry,
  onCancel,
  onCopy,
  onSaveAsNew,
}: {
  content: string;
  saving: boolean;
  retry: boolean;
  onCancel: () => void;
  onCopy: () => void;
  /** Present only after a conflict that a new prompt can resolve. */
  onSaveAsNew?: () => void;
}) => (
  <footer className="wf-dialog-foot">
    <span className="flex items-center gap-2">
      <Braces aria-hidden="true" size={14} />
      {variableHint(content)}
    </span>
    <span className="wf-grow" />
    <button
      className="wf-btn"
      disabled={saving}
      type="button"
      onClick={onCancel}
    >
      Cancel
    </button>
    <button className="wf-btn" type="button" onClick={onCopy}>
      Copy text
    </button>
    {onSaveAsNew ? (
      <button className="wf-btn" type="button" onClick={onSaveAsNew}>
        Save as new prompt
      </button>
    ) : null}
    <button className="wf-btn-accent" disabled={saving} type="submit">
      {retry ? "Retry" : "Save"}
    </button>
  </footer>
);

/** Ways out to the library that keep the mounted draft. */
const EditorContext = ({
  redirected,
  onBrowse,
  onOpenOriginal,
}: {
  redirected: boolean;
  onBrowse: () => void;
  onOpenOriginal?: () => void;
}) => (
  <>
    <div className="flex flex-wrap items-center gap-2">
      <button className="wf-btn-quiet" type="button" onClick={onBrowse}>
        Browse library (keep draft)
      </button>
      {onOpenOriginal ? (
        <button className="wf-btn-quiet" type="button" onClick={onOpenOriginal}>
          Open original
        </button>
      ) : null}
    </div>
    {redirected ? (
      <p className="wf-notice">
        You&apos;re editing the conflict copy. Your unsaved text is retained.
      </p>
    ) : null}
  </>
);

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
            "The save could not be confirmed. Keep this draft open and retry, or copy the text."
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
      setSaveError(
        "The save could not be confirmed. Keep this draft open and retry, or copy the text."
      );
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
      setCopyMessage("Text copied.");
    } catch {
      setCopyMessage(
        "Copy failed. Your text is still available; select it and copy manually, or retry Copy text."
      );
    }
  };
  const [browsing, setBrowsing] = useState(false);
  const editorLabel = initial ? "Edit prompt" : "New prompt";
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
        Resume prompt draft
      </button>
      <WayfinderDialog
        suspended={browsing}
        label={editorLabel}
        onRequestClose={requestClose}
      >
        <DialogHead
          eyebrow={editorLabel}
          title={
            initial ? draft.title || initial.prompt.title : "Create a prompt"
          }
          closeLabel="Close editor"
          closeDisabled={saving}
          onClose={requestClose}
        />
        <form
          aria-label="Prompt editor"
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
              {copyMessage}
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
            content={draft.content}
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
