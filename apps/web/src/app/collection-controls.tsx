"use client";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { organizationSnapshotSchema } from "@pr0/api-contract/prompts";
import { CollectionPicker } from "@pr0/ui/components/collection-picker";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import type { UseQueryResult } from "@tanstack/react-query";
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
}: {
  library: PrivateLibrary;
  organization: UseQueryResult<
    z.infer<typeof organizationSnapshotSchema>,
    Error
  >;
  tagIds: string[];
  onTagsChange: (ids: string[]) => void;
  collectionId: string | null;
  onSelect: (id: string | null) => void;
  onAccepted: () => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const [managing, setManaging] = useState<"collections" | "tags" | null>(null);
  const collections = organization.data?.collections ?? [];
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
        label="Collection filter"
        emptyLabel="All collections"
        collections={collections}
        value={collectionId}
        search={collectionMatches}
        onChange={onSelect}
      />
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
        tags={organization.data?.tags ?? []}
        label="Tag filters"
        value={tagIds}
        search={collectionMatches}
        onChange={onTagsChange}
      />
    </section>
  );
};
