import type {
  LocalOrganization,
  OrganizationAction,
  OrganizationLocalImpact,
  OrganizeRequest,
} from "@pr0/api-contract/local-organization";
import { organizeRequestSchema } from "@pr0/api-contract/local-organization";
import { organizationIdentity } from "@pr0/api-contract/organization";
import { CollectionList } from "@pr0/ui/components/collection-list";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  organizationClient,
  organizationError,
  organizationMatches,
} from "./organization-client";
import { OrganizationReview } from "./organization-review";
import type { Status } from "./use-auth-session";

const button =
  "rounded border px-3 py-2 focus-visible:outline-2 disabled:opacity-50";
type Tab = "collections" | "tags";
interface OrganizationEdit {
  name: string;
  id: string;
  creating?: boolean;
  replaces?: string;
}

const useOrganizationManager = ({
  account,
  snapshot,
  initialTab,
  onSaved,
  onClose,
}: {
  account: Status;
  snapshot: LocalOrganization;
  initialTab: Tab;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const flight = useRef(false);
  const unresolved = useRef<OrganizeRequest | null>(null);
  const [tab, setTab] = useState(initialTab);
  const [draft, setDraft] = useState<{
    name: string;
    baseline: string;
    id: string | null;
    replaces: string | null;
    creating: boolean;
  }>({
    name: "",
    baseline: "",
    id: null,
    replaces: null,
    creating: true,
  });
  const { name, baseline, id, replaces, creating } = draft;
  const editRevision = useRef(snapshot.localRevision);
  const setName = (value: string) =>
    setDraft((previous) => ({ ...previous, name: value }));
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [discard, setDiscard] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    action: OrganizationAction;
    impact: OrganizationLocalImpact;
    replaces: string | null;
  }>();
  const [result, setResult] = useState<{
    id: string;
    effect: OrganizationLocalImpact["effect"];
  }>();
  const entity = tab === "collections" ? "collection" : "tag";
  const entries = snapshot[tab];
  const dirty = name !== baseline || uncertain;
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.showModal();
    input.current?.focus();
    const element = dialog.current;
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);
  const clear = () => {
    setDraft({
      name: "",
      baseline: "",
      id: null,
      replaces: null,
      creating: true,
    });
    unresolved.current = null;
    setUncertain(false);
  };
  const close = () => {
    if (busy) {
      return;
    }
    if (dirty) {
      setDiscard(true);
    } else {
      onClose();
    }
  };
  const prepare = async (
    action: OrganizationAction,
    replacement: string | null = replaces
  ) => {
    try {
      setConfirmation({
        action,
        replaces: replacement,
        impact: await organizationClient.impact(action, replacement),
      });
      setErrorText("");
    } catch (error) {
      setErrorText(organizationError(error));
    }
  };
  const recover = async (error: string | null, action: OrganizationAction) => {
    try {
      if (error === "results_changed") {
        if ("name" in action) {
          const current = await organizationClient.snapshot();
          editRevision.current = current.localRevision;
          await onSaved();
        } else {
          await prepare(action);
        }
      }
      if (error === "name_conflict" && action.kind === "tag.rename") {
        try {
          const current = await organizationClient.snapshot();
          const target = current.tags.find(
            (tag) =>
              tag.id !== action.id &&
              organizationIdentity(tag.name) ===
                organizationIdentity(action.name)
          );
          if (target) {
            await prepare({
              kind: "tag.merge",
              id: action.id,
              targetId: target.id,
            });
          }
        } catch {
          setErrorText(
            "Could not refresh the merge decision. The name is retained; retry when ready."
          );
        }
      }
    } catch {
      setErrorText(
        "Could not refresh the current state. Your name is retained."
      );
    }
  };
  const save = async (
    action: OrganizationAction,
    revision?: string,
    replacement: string | null = replaces
  ) => {
    if (flight.current || !account.instanceId || !account.accountId) {
      return;
    }
    flight.current = true;
    setBusy(true);
    setErrorText("");
    const request = unresolved.current ?? {
      instanceId: account.instanceId,
      accountId: account.accountId,
      generation: account.generation,
      operationId: crypto.randomUUID(),
      action,
      replaces: replacement,
      expectedLocalRevision:
        revision ?? (creating ? snapshot.localRevision : editRevision.current),
    };
    const parsed = organizeRequestSchema.safeParse(request);
    if (!parsed.success) {
      setErrorText(parsed.error.issues[0]?.message ?? "Correct the name.");
      flight.current = false;
      setBusy(false);
      return;
    }
    unresolved.current = request;
    try {
      const saved = await organizationClient.save(request);
      unresolved.current = null;
      setMessage(
        saved.existing
          ? "This tag already exists. No prompts were assigned."
          : "Saved on this device · Changes waiting to sync"
      );
      if (saved.effect) {
        setResult({ id: request.operationId, effect: saved.effect });
      }
      setConfirmation(undefined);
      clear();
      try {
        await onSaved();
      } catch {
        setErrorText(
          "Saved on this device. Refresh the library to update the displayed counts."
        );
      }
    } catch (error) {
      // A native validation rejection has a known outcome; response decoding failures remain retryable with the same UUID.
      if (z.string().safeParse(error).success && error !== "commit_uncertain") {
        unresolved.current = null;
        setUncertain(false);
      } else {
        setUncertain(true);
      }
      setErrorText(organizationError(error));
      await recover(z.string().safeParse(error).data ?? null, action);
    }
    flight.current = false;
    setBusy(false);
  };
  const submitName = () => {
    const target = id ?? crypto.randomUUID();
    if (entity === "collection") {
      return save({
        kind: creating ? "collection.create" : "collection.rename",
        id: target,
        name,
      });
    }
    return save({
      kind: creating ? "tag.create" : "tag.rename",
      id: target,
      name,
    });
  };
  const limit = entity === "collection" ? 200 : 1000;
  let saveLabel = creating ? `Create ${entity}` : "Save name";
  if (busy) {
    saveLabel = "Saving…";
  }
  if (uncertain) {
    saveLabel = "Retry save";
  }
  const edit = (entry: OrganizationEdit) => {
    editRevision.current = snapshot.localRevision;
    setDraft({
      name: entry.name,
      baseline: entry.name,
      id: entry.id,
      replaces: entry.replaces ?? null,
      creating: entry.creating ?? false,
    });
    input.current?.focus();
  };
  return {
    dialog,
    input,
    tab,
    setTab,
    name,
    id,
    replaces,
    creating,
    busy,
    uncertain,
    message,
    errorText,
    discard,
    setDiscard,
    confirmation,
    setConfirmation,
    result,
    setResult,
    entity,
    entries,
    dirty,
    clear,
    close,
    prepare,
    save,
    submitName,
    limit,
    saveLabel,
    setName,
    setDraft,
    edit,
  };
};

const OrganizationConfirmation = ({
  confirmation,
  busy,
  entity,
  onConfirm,
  onCancel,
}: {
  confirmation: { action: OrganizationAction; impact: OrganizationLocalImpact };
  busy: boolean;
  entity: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <section
    aria-label="Confirm organization change"
    className="space-y-2 rounded border p-3"
  >
    <p>
      {confirmation.impact.effect.kind === "tag.merge"
        ? `Merge “${confirmation.impact.effect.sourceName}” into “${confirmation.impact.effect.targetName}”? The target identity and capitalization remain. Prompts already using both will have the target once.`
        : `Delete “${confirmation.impact.effect.sourceName}”?`}
    </p>
    <p>
      {confirmation.impact.effect.activeCount} active and{" "}
      {confirmation.impact.effect.archivedCount} archived prompts.{" "}
      {confirmation.impact.effect.kind === "collection.delete"
        ? "These prompts will become unassigned."
        : "Tag assignments will change."}{" "}
      Your prompts will be kept.
    </p>
    {confirmation.impact.effect.kind === "tag.merge" ? (
      <p>
        Result: {confirmation.impact.effect.targetActiveCount} active and{" "}
        {confirmation.impact.effect.targetArchivedCount} archived distinct
        prompts.
      </p>
    ) : null}
    <p>
      Selected source filters become unavailable until you explicitly remove or
      replace them. Counts describe this device’s available snapshot.
    </p>
    <button
      type="button"
      className={button}
      disabled={busy}
      onClick={onConfirm}
    >
      {confirmation.impact.effect.kind === "tag.merge"
        ? `Merge into ${confirmation.impact.effect.targetName}`
        : `Delete ${entity}`}
    </button>
    <button type="button" className={button} disabled={busy} onClick={onCancel}>
      Cancel
    </button>
  </section>
);

interface ManagerProps {
  account: Status;
  snapshot: LocalOrganization;
  initialTab: Tab;
  onSaved: () => Promise<void>;
  onClose: () => void;
}
const PendingCleanup = ({
  entry,
  disabled,
  onReview,
}: {
  entry: LocalOrganization["pending"][number];
  disabled: boolean;
  onReview: (action: OrganizationAction) => void;
}) => {
  const { operation } = entry;
  let action: OrganizationAction | null = null;
  if (operation.kind === "collection.delete") {
    action = { kind: operation.kind, id: operation.collectionId };
  }
  if (operation.kind === "tag.delete") {
    action = { kind: operation.kind, id: operation.tagId };
  }
  if (operation.kind === "tag.merge") {
    action = {
      kind: operation.kind,
      id: operation.tagId,
      targetId: operation.targetId,
    };
  }
  const selected = action;
  return (
    <div>
      <p>{organizationError(entry.error)}</p>
      {selected ? (
        <button
          className={button}
          type="button"
          disabled={disabled}
          onClick={() => onReview(selected)}
        >
          Review current cleanup and confirm again
        </button>
      ) : null}
    </div>
  );
};

const OrganizationTabs = ({
  tab,
  disabled,
  onSelect,
}: {
  tab: Tab;
  disabled: boolean;
  onSelect: (tab: Tab) => void;
}) => (
  <div role="tablist" aria-label="Organization" className="flex gap-2">
    {(["collections", "tags"] as const).map((value) => (
      <button
        key={value}
        id={`native-${value}-tab`}
        role="tab"
        aria-selected={tab === value}
        aria-controls="native-organization-panel"
        tabIndex={tab === value ? 0 : -1}
        disabled={disabled}
        className={button}
        type="button"
        onClick={() => {
          onSelect(value);
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            return;
          }
          event.preventDefault();
          let next: Tab = tab === "tags" ? "collections" : "tags";
          if (event.key === "Home") {
            next = "collections";
          }
          if (event.key === "End") {
            next = "tags";
          }
          onSelect(next);
          document
            .querySelector<HTMLButtonElement>(`#native-${next}-tab`)
            ?.focus();
        }}
      >
        {value === "collections" ? "Collections" : "Tags"}
      </button>
    ))}
  </div>
);

const PendingOrganizationChanges = ({
  pending,
  disabled,
  onReview,
  onCorrect,
}: {
  pending: LocalOrganization["pending"];
  disabled: boolean;
  onReview: (action: OrganizationAction, operationId: string) => void;
  onCorrect: (tab: Tab, entry: OrganizationEdit) => void;
}) => {
  if (!pending.some((entry) => entry.error)) {
    return null;
  }
  return (
    <section
      aria-label="Changes need attention"
      className="space-y-2 rounded border p-3"
    >
      <h3>Changes need attention</h3>
      {pending.map((entry) => {
        if (!entry.error) {
          return null;
        }
        const { operation } = entry;
        if (!("name" in operation)) {
          return (
            <PendingCleanup
              key={entry.id}
              entry={entry}
              disabled={disabled}
              onReview={(action) => {
                onReview(action, entry.id);
              }}
            />
          );
        }
        return (
          <div key={entry.id}>
            <p>
              {operation.name}: {organizationError(entry.error)}
            </p>
            <button
              type="button"
              className={button}
              disabled={disabled}
              onClick={() => {
                const collection = "collectionId" in operation;
                onCorrect(collection ? "collections" : "tags", {
                  name: operation.name,
                  id: collection ? operation.collectionId : operation.tagId,
                  creating: operation.kind.endsWith(".create"),
                  replaces: entry.id,
                });
              }}
            >
              Correct name or review merge
            </button>
          </div>
        );
      })}
    </section>
  );
};

const OrganizationSnapshotStatus = ({
  snapshot,
  count,
  limit,
  tab,
}: {
  snapshot: LocalOrganization;
  count: number;
  limit: number;
  tab: Tab;
}) => (
  <>
    {" "}
    <p>
      Counts include active and archived prompts in the available device
      snapshot.{" "}
      {snapshot.complete
        ? "Download complete."
        : "Download incomplete; counts may be incomplete."}{" "}
      {snapshot.pending.length} changes pending server acceptance.
    </p>
    {count >= limit * 0.9 ? (
      <output>
        {count} of {limit} {tab} used. Browsing and cleanup remain available.
      </output>
    ) : null}
    {snapshot.textBytes >= 94_371_840 ? (
      <output>Library text is near its 100 MiB limit.</output>
    ) : null}
  </>
);

const SavedOrganizationChanges = ({
  effects,
  onReview,
}: {
  effects: LocalOrganization["effects"];
  onReview: (result: {
    id: string;
    effect: OrganizationLocalImpact["effect"];
  }) => void;
}) => {
  if (!effects.length) {
    return null;
  }
  return (
    <section aria-label="Saved organization changes">
      <h3>Saved organization changes</h3>
      {effects.map((saved) => (
        <button
          key={saved.id}
          className={button}
          type="button"
          onClick={() => onReview({ id: saved.id, effect: saved.effect })}
        >
          Review {saved.effect.sourceName} ·{" "}
          {saved.accepted ? "Accepted by server" : "Saved on this device"}
        </button>
      ))}
    </section>
  );
};

export const OrganizationManager = (props: ManagerProps) => {
  const { snapshot, onClose } = props;
  const {
    dialog,
    input,
    tab,
    setTab,
    name,
    id,
    replaces,
    busy,
    uncertain,
    message,
    errorText,
    discard,
    setDiscard,
    confirmation,
    setConfirmation,
    result,
    setResult,
    entity,
    entries,
    dirty,
    clear,
    close,
    prepare,
    save,
    submitName,
    limit,
    saveLabel,
    setName,
    edit,
  } = useOrganizationManager(props);
  const interactionBlocked = dirty || busy || Boolean(confirmation);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="native-organization-title"
      className="bg-background text-foreground m-auto max-h-[90dvh] w-[min(44rem,94vw)] space-y-3 overflow-y-auto rounded-lg border p-5 backdrop:bg-black/50"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="native-organization-title" className="text-xl font-semibold">
        Manage collections and tags
      </h2>
      <OrganizationTabs
        tab={tab}
        disabled={interactionBlocked}
        onSelect={(next) => {
          clear();
          setTab(next);
        }}
      />
      <section
        id="native-organization-panel"
        role="tabpanel"
        aria-labelledby={`native-${tab}-tab`}
        className="space-y-3"
      >
        <OrganizationSnapshotStatus
          snapshot={snapshot}
          count={entries.length}
          limit={limit}
          tab={tab}
        />
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitName();
          }}
        >
          <label htmlFor="native-organization-name">
            {entity === "tag" ? "Tag" : "Collection"} name
          </label>
          <input
            ref={input}
            id="native-organization-name"
            value={name}
            readOnly={busy || Boolean(confirmation) || uncertain}
            aria-invalid={Boolean(errorText)}
            aria-describedby="native-organization-error"
            className="bg-background block w-full rounded border p-2"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className={button}
            type="submit"
            disabled={busy || Boolean(confirmation)}
          >
            {saveLabel}
          </button>
          {id ? (
            <button
              className={button}
              type="button"
              disabled={busy || uncertain}
              onClick={clear}
            >
              Cancel rename
            </button>
          ) : null}
        </form>
        <p role="alert" id="native-organization-error">
          {errorText}
        </p>
        <output>{message}</output>
        <CollectionList
          collections={entries}
          label={tab === "tags" ? "Tags" : "Collections"}
          search={organizationMatches}
          disabled={interactionBlocked}
          onRename={(entry) => {
            edit(entry);
          }}
          onDelete={(entry) => {
            void prepare({
              kind: entity === "tag" ? "tag.delete" : "collection.delete",
              id: entry.id,
            });
          }}
        />
      </section>
      <PendingOrganizationChanges
        pending={snapshot.pending}
        disabled={busy || dirty}
        onReview={(action, operationId) => {
          void prepare(action, operationId);
        }}
        onCorrect={(next, entry) => {
          setTab(next);
          edit(entry);
        }}
      />
      {replaces ? <p>Correcting a saved change that needs attention.</p> : null}
      {confirmation ? (
        <OrganizationConfirmation
          confirmation={confirmation}
          busy={busy}
          entity={entity}
          onConfirm={() => {
            void save(
              confirmation.action,
              confirmation.impact.localRevision,
              confirmation.replaces
            );
          }}
          onCancel={() => setConfirmation(undefined)}
        />
      ) : null}
      <SavedOrganizationChanges
        effects={snapshot.effects}
        onReview={setResult}
      />
      {result ? (
        <OrganizationReview
          operationId={result.id}
          effect={result.effect}
          snapshot={snapshot}
        />
      ) : null}
      <button type="button" className={button} disabled={busy} onClick={close}>
        Close
      </button>
      {discard ? (
        <section aria-label="Discard unsaved name">
          <p>
            Discard this unsaved name? Saved pending work remains on this
            device.
          </p>
          <button type="button" className={button} onClick={onClose}>
            Discard name
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setDiscard(false)}
          >
            Keep editing
          </button>
        </section>
      ) : null}
    </dialog>
  );
};
