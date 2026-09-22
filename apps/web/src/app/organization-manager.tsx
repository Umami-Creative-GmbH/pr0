"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { organizationIdentity } from "@pr0/api-contract/organization";
import type { Collection, Tag } from "@pr0/api-contract/prompts";
import { promptLimits } from "@pr0/api-contract/prompts";
import { CollectionList } from "@pr0/ui/components/collection-list";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { localizedLabel, translate } from "@pr0/ui/lib/i18n";
import { useEffect, useRef, useState } from "react";

import { collectionMatches } from "./collection-query";
import { OrganizationCapacity } from "./organization-capacity";
import { OrganizationCleanupPanel } from "./organization-cleanup";
import type { CleanupRequest } from "./organization-cleanup";
import { OrganizationTabs } from "./organization-tabs";
import { useOrganizationNameSave } from "./use-organization-name-save";

const buttonClass = "wf-btn";
const cleanupSelected = (request: CleanupRequest | null, ids: string[]) =>
  request !== null && ids.includes(request.sourceId);
const tabLabels = () => ({
  collections: {
    singular: translate("collection"),
    plural: translate("collections"),
    limit: promptLimits.collectionCount,
    entity: "collection" as const,
  },
  tags: {
    singular: translate("tag"),
    plural: translate("tags"),
    limit: promptLimits.tagCount,
    entity: "tag" as const,
  },
});
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
  selectedIds,
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
  selectedIds: string[];
}) => {
  const t = useTranslations();

  const [tab, setTab] = useState(initialTab);
  const client = useApiClient();
  const [cleanup, setCleanup] = useState<CleanupRequest | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const entries = { collections, tags }[tab];
  const { singular, plural, limit, entity } = tabLabels()[tab];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [baseline, setBaseline] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [discard, setDiscard] = useState<"close" | "create" | null>(null);
  const { state, save } = useOrganizationNameSave(library, onAccepted, entity);
  const dirty =
    name !== baseline || state.busy || state.uncertain || cleanupBusy;
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
    if (state.busy || cleanupBusy) {
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
    } else if (entity === "tag" && editing) {
      try {
        const snapshot = await client.getOrganization(
          AbortSignal.timeout(30_000),
          { instanceId: library.instance.id, accountId: library.account.id }
        );
        const target = snapshot.tags.find(
          (tag) =>
            tag.id !== editing &&
            organizationIdentity(tag.name) === organizationIdentity(name)
        );
        if (target) {
          setCleanup({
            kind: "tag.merge",
            sourceId: editing,
            targetId: target.id,
          });
        }
      } catch {
        /* The retained name and existing error provide the retry path. */
      }
    }
  };
  const actionLabel = editing
    ? t("saveName")
    : t("createValue", [localizedLabel(singular)]);
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
        {t("manageCollectionsAndTags")}
      </h2>
      <OrganizationTabs
        value={tab}
        disabled={dirty || Boolean(cleanup)}
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
        <OrganizationCapacity
          count={entries.length}
          limit={limit}
          plural={plural}
          singular={singular}
          textBytes={textBytes}
          loading={loading}
          error={error}
          onRetry={onRetry}
        />
        <form
          className="space-y-2 rounded-md border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block font-medium" htmlFor="collection-name">
            {singular} {t("name")}
          </label>
          <input
            id="collection-name"
            ref={nameRef}
            aria-invalid={Boolean(state.error)}
            aria-describedby="collection-name-error"
            readOnly={
              loading || state.busy || state.uncertain || Boolean(cleanup)
            }
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
              disabled={state.busy || loading || Boolean(cleanup)}
            >
              {state.uncertain ? t("retry") : actionLabel}
            </button>
            {editing ? (
              <button
                type="button"
                className={buttonClass}
                disabled={state.busy || state.uncertain || Boolean(cleanup)}
                onClick={() => {
                  if (dirty) {
                    setDiscard("create");
                  } else {
                    clear();
                  }
                }}
              >
                {t("cancelRename")}
              </button>
            ) : null}
          </div>
        </form>
        <output>
          <LocalizedMessage value={state.message} />
        </output>
        <CollectionList
          collections={entries}
          label={plural}
          search={collectionMatches}
          disabled={dirty || Boolean(cleanup)}
          onDelete={(entry) =>
            setCleanup({
              kind:
                entity === "collection" ? "collection.delete" : "tag.delete",
              sourceId: entry.id,
            })
          }
          onRename={(entry) => {
            setEditing(entry.id);
            setName(entry.name);
            setBaseline(entry.name);
            nameRef.current?.focus();
          }}
        />
      </section>
      <OrganizationCleanupPanel
        library={library}
        request={cleanup}
        selected={cleanupSelected(cleanup, selectedIds)}
        onCancel={() => {
          setCleanup(null);
          nameRef.current?.focus();
        }}
        onBusyChange={(value) => {
          setCleanupBusy(value);
          onDirtyChange(value || name !== baseline);
        }}
        onAccepted={async () => {
          clear();
          await onAccepted();
        }}
      />
      <button
        type="button"
        className={`${buttonClass} mt-4`}
        disabled={state.busy || cleanupBusy}
        onClick={close}
      >
        {t("close")}
      </button>
      {discard ? (
        <section
          aria-label={t("discardValueDraft", [localizedLabel(singular)])}
          className="mt-3 rounded-md border p-3"
        >
          <p>
            {state.uncertain
              ? t("theServerMayAlreadyHaveSavedThisNameRetryFirst")
              : t("discardThisUnsavedValueName", [localizedLabel(singular)])}
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
              {t("discardName")}
            </button>
            <button
              className={buttonClass}
              type="button"
              onClick={() => {
                setDiscard(null);
                nameRef.current?.focus();
              }}
            >
              {t("keepEditing")}
            </button>
          </div>
        </section>
      ) : null}
    </dialog>
  );
};
