import type {
  LocalOrganization,
  OrganizationAction,
  OrganizationLocalImpact,
} from "@pr0/api-contract/local-organization";
import { CollectionList } from "@pr0/ui/components/collection-list";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
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
}) => {
  const t = useTranslations();
  return (
    <section
      aria-label={t("confirmOrganizationChange")}
      className="space-y-2 rounded border p-3"
    >
      <p>
        {confirmation.impact.effect.kind === "tag.merge"
          ? t("mergeValueIntoValueTheTargetIdentityAndCapitalizationRemain", [
              confirmation.impact.effect.sourceName,
              confirmation.impact.effect.targetName,
            ])
          : t("deleteValue", [confirmation.impact.effect.sourceName])}
      </p>
      <p>
        {confirmation.impact.effect.activeCount} {t("activeAnd")}{" "}
        {confirmation.impact.effect.archivedCount} {t("archivedPrompts")}{" "}
        {confirmation.impact.effect.kind === "collection.delete"
          ? t("thesePromptsWillBecomeUnassigned")
          : t("tagAssignmentsWillChange")}{" "}
        {t("yourPromptsWillBeKept")}
      </p>
      {confirmation.impact.effect.kind === "tag.merge" ? (
        <p>
          {t("result")} {confirmation.impact.effect.targetActiveCount}{" "}
          {t("activeAnd")} {confirmation.impact.effect.targetArchivedCount}{" "}
          {t("archivedDistinctPrompts")}
        </p>
      ) : null}
      <p>
        {t("selectedSourceFiltersBecomeUnavailableUntilYouExplicitlyRemoveOr")}
      </p>
      <button
        type="button"
        className={button}
        disabled={busy}
        onClick={onConfirm}
      >
        {confirmation.impact.effect.kind === "tag.merge"
          ? t("mergeIntoValue", [confirmation.impact.effect.targetName])
          : t("deleteValue2", [
              t(entity === "collection" ? "collection" : "tag"),
            ])}
      </button>
      <button
        type="button"
        className={button}
        disabled={busy}
        onClick={onCancel}
      >
        {t("cancel")}
      </button>
    </section>
  );
};

const PendingCleanup = ({
  entry,
  disabled,
  onReview,
}: {
  entry: LocalOrganization["pending"][number];
  disabled: boolean;
  onReview: (action: OrganizationAction) => void;
}) => {
  const t = useTranslations();

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
          {t("reviewCurrentCleanupAndConfirmAgain")}
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
}) => {
  const t = useTranslations();
  return (
    <div role="tablist" aria-label={t("organization")} className="flex gap-2">
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
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
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
          {value === "collections" ? t("collections") : t("tags")}
        </button>
      ))}
    </div>
  );
};

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
  const t = useTranslations();

  if (!pending.some((entry) => entry.error)) {
    return null;
  }
  return (
    <section
      aria-label={t("changesNeedAttention")}
      className="space-y-2 rounded border p-3"
    >
      <h3>{t("changesNeedAttention")}</h3>
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
              {t("correctNameOrReviewMerge")}
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
}) => {
  const t = useTranslations();
  return (
    <>
      {" "}
      <p>
        {t("countsIncludeActiveAndArchivedPromptsInTheAvailableDevice")}{" "}
        {snapshot.complete
          ? t("downloadComplete")
          : t("downloadIncompleteCountsMayBeIncomplete")}{" "}
        {snapshot.pending.length} {t("changesPendingServerAcceptance")}
      </p>
      {count >= limit * 0.9 ? (
        <output>
          {count} {t("of")} {limit} {tab}{" "}
          {t("usedBrowsingAndCleanupRemainAvailable")}
        </output>
      ) : null}
      {snapshot.textBytes >= 94_371_840 ? (
        <output>{t("libraryTextIsNearIts100MibLimit")}</output>
      ) : null}
    </>
  );
};

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
  const t = useTranslations();

  if (!effects.length) {
    return null;
  }
  return (
    <section aria-label={t("savedOrganizationChanges")}>
      <h3>{t("savedOrganizationChanges")}</h3>
      {effects.map((saved) => (
        <button
          key={saved.id}
          className={button}
          type="button"
          onClick={() => onReview({ id: saved.id, effect: saved.effect })}
        >
          {t("review")} {saved.effect.sourceName} ·{" "}
          {saved.accepted ? t("acceptedByServer") : t("savedOnThisDevice")}
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
}) => {
  const t = useTranslations();
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="native-organization-name">
        {entity === "tag" ? t("tag") : t("collection")} {t("name")}
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
          {t("cancelRename")}
        </button>
      ) : null}
    </form>
  );
};

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
  const t = useTranslations();

  if (!open) {
    return null;
  }
  return (
    <section aria-label={t("discardUnsavedName")}>
      <p>{t("discardThisUnsavedNameSavedPendingWorkRemainsOnThis")}</p>
      <button type="button" className={button} onClick={onDiscard}>
        {t("discardName")}
      </button>
      <button type="button" className={button} onClick={onContinue}>
        {t("keepEditing")}
      </button>
    </section>
  );
};

export const OrganizationManager = (props: ManagerProps) => {
  const t = useTranslations();

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
        {t("manageCollectionsAndTags")}
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
          <LocalizedMessage value={errorText} />
        </p>
        <output>
          <LocalizedMessage value={message} />
        </output>
        <CollectionList
          collections={entries}
          label={tab === "tags" ? t("tags") : t("collections")}
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
      {replaces ? <p>{t("correctingASavedChangeThatNeedsAttention")}</p> : null}
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
        {t("close")}
      </button>
      <OrganizationDiscardConfirmation
        open={discard}
        onDiscard={onClose}
        onContinue={() => setDiscard(false)}
      />
    </dialog>
  );
};
