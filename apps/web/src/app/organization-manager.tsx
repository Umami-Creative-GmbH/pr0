"use client";

import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { Collection, Tag } from "@pr0/api-contract/prompts";
import { promptLimits } from "@pr0/api-contract/prompts";
import { CollectionList } from "@pr0/ui/components/collection-list";
import { useEffect, useRef, useState } from "react";

import { collectionMatches } from "./collection-query";
import { OrganizationTabs } from "./organization-tabs";
import { useOrganizationNameSave } from "./use-organization-name-save";

const buttonClass =
  "rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const tabLabels = {
  collections: {
    singular: "Collection",
    plural: "Collections" as const,
    limit: promptLimits.collectionCount,
    entity: "collection" as const,
  },
  tags: {
    singular: "Tag",
    plural: "Tags" as const,
    limit: promptLimits.tagCount,
    entity: "tag" as const,
  },
};
export const OrganizationManager = ({
  library,
  collections,
  tags,
  initialTab = "collections",
  textBytes,
  loading,
  error,
  onRetry,
  onAccepted,
  onClose,
  onDirtyChange,
}: {
  library: PrivateLibrary;
  collections: Collection[];
  tags: Tag[];
  initialTab?: "collections" | "tags";
  textBytes: number;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onAccepted: () => void | Promise<void>;
  onClose: () => void;
  onDirtyChange: (value: boolean) => void;
}) => {
  const [tab, setTab] = useState(initialTab);
  const entries = { collections, tags }[tab];
  const { singular, plural, limit, entity } = tabLabels[tab];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [baseline, setBaseline] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [discard, setDiscard] = useState<"close" | "create" | null>(null);
  const { state, save } = useOrganizationNameSave(library, onAccepted, entity);
  const dirty = name !== baseline || state.busy || state.uncertain;
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    nameRef.current?.focus();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const close = () => {
    if (state.busy) {
      return;
    }
    if (dirty) {
      setDiscard("close");
    } else {
      onDirtyChange(false);
      onClose();
    }
  };
  const clear = () => {
    setName("");
    setBaseline("");
    setEditing(null);
    onDirtyChange(false);
    nameRef.current?.focus();
  };
  const submit = async () => {
    onDirtyChange(true);
    const accepted = await save(name, editing);
    if (accepted) {
      clear();
    }
  };
  const actionLabel = editing
    ? "Save name"
    : `Create ${singular.toLowerCase()}`;
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="manage-organization-title"
      className="bg-background text-foreground m-auto max-h-[90dvh] w-[min(44rem,94vw)] overflow-y-auto rounded-lg border p-5 backdrop:bg-black/50"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="manage-organization-title" className="text-xl font-semibold">
        Manage collections and tags
      </h2>
      <OrganizationTabs
        value={tab}
        disabled={dirty}
        onChange={(value) => {
          clear();
          setTab(value);
        }}
      />
      <section
        role="tabpanel"
        id="organization-panel"
        aria-labelledby={`${tab}-tab`}
        className="space-y-3"
      >
        <p>
          {entries.length} / {limit} {plural.toLowerCase()} ·{" "}
          {(textBytes / 1_048_576).toFixed(2)} / 100 MiB library text
        </p>
        <p className="text-muted-foreground text-sm">
          Counts are library-wide, including the archive, for the available
          snapshot.
        </p>
        {entries.length >= limit * promptLimits.warningRatio ? (
          <output>
            Your library is at or above 90% of its{" "}
            {limit.toLocaleString("en-US")} {singular.toLowerCase()} limit.
          </output>
        ) : null}
        {textBytes >= promptLimits.libraryBytes * promptLimits.warningRatio ? (
          <output>
            Your library is at or above 90% of its 100 MiB text limit.
          </output>
        ) : null}
        {loading ? <output>Loading {plural.toLowerCase()}…</output> : null}
        {error ? (
          <div role="alert">
            {error}{" "}
            <button className={buttonClass} type="button" onClick={onRetry}>
              Retry {plural.toLowerCase()}
            </button>
          </div>
        ) : null}
        <form
          className="space-y-2 rounded-md border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block font-medium" htmlFor="collection-name">
            {singular} name
          </label>
          <input
            id="collection-name"
            ref={nameRef}
            aria-invalid={Boolean(state.error)}
            aria-describedby="collection-name-error"
            readOnly={loading || state.busy || state.uncertain}
            className="bg-background w-full rounded-md border p-2 focus-visible:outline-2"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              onDirtyChange(event.target.value !== baseline);
            }}
          />
          <p id="collection-name-error">{state.error}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={buttonClass}
              disabled={state.busy || loading}
            >
              {state.uncertain ? "Retry" : actionLabel}
            </button>
            {editing ? (
              <button
                type="button"
                className={buttonClass}
                disabled={state.busy || state.uncertain}
                onClick={() => {
                  if (dirty) {
                    setDiscard("create");
                  } else {
                    clear();
                  }
                }}
              >
                Cancel rename
              </button>
            ) : null}
          </div>
        </form>
        <output>{state.message}</output>
        <CollectionList
          collections={entries}
          label={plural}
          search={collectionMatches}
          disabled={dirty}
          onRename={(entry) => {
            setEditing(entry.id);
            setName(entry.name);
            setBaseline(entry.name);
            nameRef.current?.focus();
          }}
        />
      </section>
      <button
        type="button"
        className={`${buttonClass} mt-4`}
        disabled={state.busy}
        onClick={close}
      >
        Close
      </button>
      {discard ? (
        <section
          aria-label={`Discard ${singular.toLowerCase()} draft`}
          className="mt-3 rounded-md border p-3"
        >
          <p>
            {state.uncertain
              ? "The server may already have saved this name. Retry first to confirm its outcome, or explicitly discard this open-tab draft."
              : `Discard this unsaved ${singular.toLowerCase()} name?`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={buttonClass}
              type="button"
              onClick={() => {
                if (discard === "close") {
                  onDirtyChange(false);
                  onClose();
                } else {
                  clear();
                  setDiscard(null);
                }
              }}
            >
              Discard name
            </button>
            <button
              className={buttonClass}
              type="button"
              onClick={() => {
                setDiscard(null);
                nameRef.current?.focus();
              }}
            >
              Keep editing
            </button>
          </div>
        </section>
      ) : null}
    </dialog>
  );
};
