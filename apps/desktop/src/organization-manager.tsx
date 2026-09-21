import type {
  LocalOrganization,
  OrganizationAction,
  OrganizationLocalImpact,
} from "@pr0/api-contract/local-organization";
import { CollectionList } from "@pr0/ui/components/collection-list";
import type { RefObject } from "react";

import { organizationError, organizationMatches } from "./organization-client";
import { OrganizationReview } from "./organization-review";
import { useOrganizationManager } from "./use-organization-manager";
import type {
  ManagerProps,
  OrganizationEdit,
  Tab,
} from "./use-organization-manager";

const button =
  "rounded border px-3 py-2 focus-visible:outline-2 disabled:opacity-50";
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

const OrganizationNameForm = ({
  input,
  entity,
  name,
  renaming,
  busy,
  confirming,
  uncertain,
  invalid,
  saveLabel,
  onSubmit,
  onChange,
  onCancel,
}: {
  input: RefObject<HTMLInputElement | null>;
  entity: string;
  name: string;
  renaming: boolean;
  busy: boolean;
  confirming: boolean;
  uncertain: boolean;
  invalid: boolean;
  saveLabel: string;
  onSubmit: () => void;
  onChange: (name: string) => void;
  onCancel: () => void;
}) => (
  <form
    className="space-y-2"
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    <label htmlFor="native-organization-name">
      {entity === "tag" ? "Tag" : "Collection"} name
    </label>
    <input
      ref={input}
      id="native-organization-name"
      value={name}
      readOnly={busy || confirming || uncertain}
      aria-invalid={invalid}
      aria-describedby="native-organization-error"
      className="bg-background block w-full rounded border p-2"
      onChange={(event) => onChange(event.target.value)}
    />
    <button className={button} type="submit" disabled={busy || confirming}>
      {saveLabel}
    </button>
    {renaming ? (
      <button
        className={button}
        type="button"
        disabled={busy || uncertain}
        onClick={onCancel}
      >
        Cancel rename
      </button>
    ) : null}
  </form>
);

type OrganizationConfirmationState = NonNullable<
  ReturnType<typeof useOrganizationManager>["confirmation"]
>;

const PendingOrganizationConfirmation = ({
  confirmation,
  busy,
  entity,
  onConfirm,
  onCancel,
}: {
  confirmation: OrganizationConfirmationState | undefined;
  busy: boolean;
  entity: string;
  onConfirm: (selected: OrganizationConfirmationState) => void;
  onCancel: () => void;
}) => {
  if (!confirmation) {
    return null;
  }
  return (
    <OrganizationConfirmation
      confirmation={confirmation}
      busy={busy}
      entity={entity}
      onConfirm={() => onConfirm(confirmation)}
      onCancel={onCancel}
    />
  );
};

const SelectedOrganizationReview = ({
  result,
  snapshot,
}: {
  result: { id: string; effect: OrganizationLocalImpact["effect"] } | undefined;
  snapshot: LocalOrganization;
}) => {
  if (!result) {
    return null;
  }
  return (
    <OrganizationReview
      operationId={result.id}
      effect={result.effect}
      snapshot={snapshot}
    />
  );
};

const OrganizationDiscardConfirmation = ({
  open,
  onDiscard,
  onContinue,
}: {
  open: boolean;
  onDiscard: () => void;
  onContinue: () => void;
}) => {
  if (!open) {
    return null;
  }
  return (
    <section aria-label="Discard unsaved name">
      <p>
        Discard this unsaved name? Saved pending work remains on this device.
      </p>
      <button type="button" className={button} onClick={onDiscard}>
        Discard name
      </button>
      <button type="button" className={button} onClick={onContinue}>
        Keep editing
      </button>
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
        <OrganizationNameForm
          input={input}
          entity={entity}
          name={name}
          renaming={Boolean(id)}
          busy={busy}
          confirming={Boolean(confirmation)}
          uncertain={uncertain}
          invalid={Boolean(errorText)}
          saveLabel={saveLabel}
          onSubmit={() => {
            void submitName();
          }}
          onChange={setName}
          onCancel={clear}
        />
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
      <PendingOrganizationConfirmation
        confirmation={confirmation}
        busy={busy}
        entity={entity}
        onConfirm={(selected) => {
          void save(
            selected.action,
            selected.impact.localRevision,
            selected.replaces
          );
        }}
        onCancel={() => setConfirmation(undefined)}
      />
      <SavedOrganizationChanges
        effects={snapshot.effects}
        onReview={setResult}
      />
      <SelectedOrganizationReview result={result} snapshot={snapshot} />
      <button type="button" className={button} disabled={busy} onClick={close}>
        Close
      </button>
      <OrganizationDiscardConfirmation
        open={discard}
        onDiscard={onClose}
        onContinue={() => setDiscard(false)}
      />
    </dialog>
  );
};
