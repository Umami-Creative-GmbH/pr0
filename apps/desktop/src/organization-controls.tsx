import type {
  LocalOrganization,
  OrganizeRequest,
} from "@pr0/api-contract/local-organization";
import type { LocalPrompt } from "@pr0/api-contract/local-prompts";
import { CollectionPicker } from "@pr0/ui/components/collection-picker";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useRef, useState } from "react";
import { z } from "zod";

import {
  organizationClient,
  organizationError,
  organizationMatches,
} from "./organization-client";
import { OrganizationManager } from "./organization-manager";
import type { Status } from "./use-auth-session";

export interface OrganizationFilters {
  collectionId: string | null;
  tagIds: string[];
}
export const OrganizationControls = ({
  account,
  snapshot,
  filters,
  onFilters,
  onSaved,
  disabled,
  onEditing,
}: {
  account: Status;
  snapshot: LocalOrganization;
  filters: OrganizationFilters;
  onFilters: (value: OrganizationFilters) => void;
  onSaved: () => Promise<void>;
  disabled: boolean;
  onEditing: (value: boolean) => void;
}) => {
  const t = useTranslations();

  const [manager, setManager] = useState<"collections" | "tags">();
  const selectedTags = new Set(filters.tagIds);
  const unavailable = new Map(
    snapshot.states.map((entry) => [
      entry.id,
      `${entry.name} · ${entry.state === "merged" ? t("mergedIntoValue", [entry.targetName ?? t("aDeletedTag")]) : t("deleted")}`,
    ])
  );
  const open = (tab: "collections" | "tags") => {
    setManager(tab);
    onEditing(true);
  };
  return (
    <section
      aria-label={t("collectionsAndTags")}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <div className="wf-section-head">
            <h3 className="wf-eyebrow">{t("collections")}</h3>
            <button
              type="button"
              aria-label={t("manageCollections")}
              className="wf-btn-quiet"
              disabled={disabled}
              onClick={() => open("collections")}
            >
              {t("manage")}
            </button>
          </div>
          <CollectionPicker
            compact
            collections={snapshot.collections}
            value={filters.collectionId}
            onChange={(collectionId) => onFilters({ ...filters, collectionId })}
            search={organizationMatches}
            label={t("collectionFilter")}
            emptyLabel={t("allCollections")}
            unavailableName={
              filters.collectionId
                ? (unavailable.get(filters.collectionId) ??
                  t("deletedCollection"))
                : undefined
            }
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="wf-section-head">
            <h3 className="wf-eyebrow">{t("tags")}</h3>
            <button
              type="button"
              aria-label={t("manageTags")}
              className="wf-btn-quiet"
              disabled={disabled}
              onClick={() => open("tags")}
            >
              {t("manage")}
            </button>
          </div>
          <TagPicker
            compact
            tags={snapshot.tags}
            value={filters.tagIds}
            onChange={(tagIds) => onFilters({ ...filters, tagIds })}
            search={organizationMatches}
            label={t("tagFilters")}
            unavailableNames={unavailable}
          />
        </div>
      </div>
      {snapshot.states.map((state) =>
        selectedTags.has(state.id) && state.targetId ? (
          <button
            type="button"
            key={state.id}
            className="wf-btn"
            onClick={() => {
              if (state.targetId) {
                onFilters({
                  ...filters,
                  tagIds: [
                    ...new Set(
                      filters.tagIds.map((id) =>
                        id === state.id ? (state.targetId ?? id) : id
                      )
                    ),
                  ],
                });
              }
            }}
          >
            {t("use")} {state.targetName} {t("instead")}
          </button>
        ) : null
      )}
      {manager ? (
        <OrganizationManager
          account={account}
          snapshot={snapshot}
          initialTab={manager}
          onSaved={onSaved}
          onClose={() => {
            setManager(undefined);
            onEditing(false);
          }}
        />
      ) : null}
    </section>
  );
};
export const PromptOrganization = ({
  account,
  value,
  snapshot,
  onSaved,
  disabled,
}: {
  account: Status;
  value: LocalPrompt;
  snapshot: LocalOrganization;
  onSaved: () => Promise<void>;
  disabled: boolean;
}) => {
  const t = useTranslations();

  const [busy, setBusy] = useState(false);
  const unresolved = useRef<OrganizeRequest | null>(null);
  const flight = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const save = async (
    action: Parameters<typeof organizationClient.save>[0]["action"]
  ) => {
    if (flight.current || !account.instanceId || !account.accountId) {
      return;
    }
    setBusy(true);
    flight.current = true;
    const request = unresolved.current ?? {
      instanceId: account.instanceId,
      accountId: account.accountId,
      generation: account.generation,
      operationId: crypto.randomUUID(),
      expectedLocalRevision: value.localRevision,
      action,
    };
    unresolved.current = request;
    try {
      await organizationClient.save(request);
      unresolved.current = null;
      setUncertain(false);
      setMessage(t("savedOnThisDeviceChangesWaitingToSync"));
      try {
        await onSaved();
      } catch {
        setMessage(t("savedOnThisDeviceRefreshTheLibraryToUpdateThe"));
      }
    } catch (error) {
      const known =
        z.string().safeParse(error).success && error !== "commit_uncertain";
      if (known) {
        unresolved.current = null;
      }
      setUncertain(!known);
      setMessage(organizationError(error));
    }
    flight.current = false;
    setBusy(false);
  };
  return (
    <section aria-label={t("promptOrganization")} className="space-y-2">
      <CollectionPicker
        compact
        collections={snapshot.collections}
        value={value.prompt.collectionId}
        onChange={(collectionId) => {
          void save({
            kind: "prompt.collection",
            id: value.prompt.id,
            collectionId,
          });
        }}
        search={organizationMatches}
        label={t("promptCollection")}
        emptyLabel={t("noCollection")}
        disabled={disabled || busy || uncertain}
      />
      <TagPicker
        compact
        tags={snapshot.tags}
        value={value.prompt.tagIds}
        onChange={(ids) => {
          const previous = new Set(value.prompt.tagIds);
          const next = new Set(ids);
          void save({
            kind: "prompt.tags",
            id: value.prompt.id,
            add: ids.filter((id) => !previous.has(id)),
            remove: value.prompt.tagIds.filter((id) => !next.has(id)),
          });
        }}
        search={organizationMatches}
        label={t("promptTags")}
        disabled={disabled || busy || uncertain}
      />
      <output>
        <LocalizedMessage value={message} />
      </output>
      {uncertain ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (unresolved.current) {
              void save(unresolved.current.action);
            }
          }}
        >
          {t("retrySavedAssignment")}
        </button>
      ) : null}
    </section>
  );
};
