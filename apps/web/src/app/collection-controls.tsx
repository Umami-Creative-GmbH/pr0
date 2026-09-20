"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { organizationSnapshotSchema } from "@pr0/api-contract/prompts";
import { CollectionPicker } from "@pr0/ui/components/collection-picker";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";

import { collectionMatches } from "./collection-query";
import { OrganizationManager } from "./organization-manager";

const buttonClass =
  "rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
export const CollectionControls = ({
  library,
  organization,
  collectionId,
  onSelect,
  onAccepted,
  onDirtyChange,
  tagIds,
  onTagsChange,
  onAllPrompts,
}: {
  library: PrivateLibrary;
  organization: UseQueryResult<
    z.infer<typeof organizationSnapshotSchema>,
    Error
  >;
  tagIds: string[];
  onTagsChange: (ids: string[]) => void;
  onAllPrompts: () => void;
  collectionId: string | null;
  onSelect: (id: string | null) => void;
  onAccepted: () => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const [managing, setManaging] = useState<"collections" | "tags" | null>(null);
  const client = useApiClient();
  const selectedIds = [...tagIds, ...(collectionId ? [collectionId] : [])];
  const selectedTags = new Set(tagIds);
  const missing = selectedIds.filter(
    (id) =>
      !organization.data?.tags.some((tag) => tag.id === id) &&
      !organization.data?.collections.some((collection) => collection.id === id)
  );
  const states = useQuery({
    queryKey: [
      "organization-states",
      library.instance.id,
      library.account.id,
      missing,
    ],
    enabled: missing.length > 0,
    queryFn: async ({ signal }) => {
      const scope = {
        instanceId: library.instance.id,
        accountId: library.account.id,
      };
      const results = await Promise.all(
        [missing.slice(0, 1000), missing.slice(1000)]
          .filter((ids) => ids.length)
          .map((ids) => client.getOrganizationStates(ids, signal, scope))
      );
      return results.flatMap((result) => result.states);
    },
    refetchInterval: 5000,
  });
  const collections = organization.data?.collections ?? [];
  const unavailableNames = new Map(
    states.data?.map((state) => [
      state.id,
      `${state.name} · ${state.state === "deleted" ? "Deleted" : "Merged"}`,
    ])
  );
  const error = organization.isError
    ? "Could not refresh collections. Counts may be stale."
    : "";
  const refresh = () => {
    void organization.refetch();
  };
  return (
    <section aria-label="Collections" className="space-y-3">
      {managing ? (
        <OrganizationManager
          library={library}
          selectedIds={selectedIds}
          collections={collections}
          tags={organization.data?.tags ?? []}
          initialTab={managing}
          textBytes={organization.data?.textBytes ?? 0}
          loading={organization.isPending}
          error={error}
          onRetry={refresh}
          onAccepted={onAccepted}
          onClose={() => {
            onDirtyChange(false);
            setManaging(null);
          }}
          onDirtyChange={onDirtyChange}
        />
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Collections</h2>
        <button
          className={buttonClass}
          type="button"
          aria-label="Manage collections"
          onClick={() => {
            setManaging("collections");
            refresh();
          }}
        >
          Manage
        </button>
      </div>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button className={buttonClass} type="button" onClick={refresh}>
            Retry collections
          </button>
        </p>
      ) : null}
      <CollectionPicker
        unavailableName={
          collectionId ? unavailableNames.get(collectionId) : undefined
        }
        label="Collection filter"
        emptyLabel="All collections"
        collections={collections}
        value={collectionId}
        search={collectionMatches}
        onChange={onSelect}
      />
      {collectionId &&
      states.data?.some((state) => state.id === collectionId) ? (
        <p>
          {states.data.find((state) => state.id === collectionId)?.name} ·
          Deleted. This collection is unavailable; no prompts match.{" "}
          <button type="button" className={buttonClass} onClick={onAllPrompts}>
            Go to All prompts
          </button>
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Tags</h2>
        <button
          type="button"
          className={buttonClass}
          aria-label="Manage tags"
          onClick={() => {
            setManaging("tags");
            refresh();
          }}
        >
          Manage
        </button>
      </div>
      <TagPicker
        unavailableNames={unavailableNames}
        tags={organization.data?.tags ?? []}
        label="Tag filters"
        value={tagIds}
        search={collectionMatches}
        onChange={onTagsChange}
      />
      <div className="max-h-36 overflow-y-auto">
        {states.data?.map((state) =>
          state.entity === "tag" && selectedTags.has(state.id) ? (
            <p key={state.id}>
              {state.name} ·{" "}
              {state.state === "deleted"
                ? "Deleted"
                : `Merged into ${state.targetName ?? "a deleted tag"}`}
              . No matches until removed or replaced.{" "}
              {state.targetId ? (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    const { targetId } = state;
                    if (targetId) {
                      onTagsChange([
                        ...new Set(
                          tagIds.map((id) => (id === state.id ? targetId : id))
                        ),
                      ]);
                    }
                  }}
                >
                  Use {state.targetName} instead
                </button>
              ) : null}
            </p>
          ) : null
        )}
      </div>
    </section>
  );
};
