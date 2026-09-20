"use client";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { organizationSnapshotSchema } from "@pr0/api-contract/prompts";
import { CollectionPicker } from "@pr0/ui/components/collection-picker";
import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";

import { CollectionManager } from "./collection-manager";
import { collectionMatches } from "./collection-query";

const buttonClass =
  "rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
export const CollectionControls = ({
  library,
  organization,
  collectionId,
  onSelect,
  onAccepted,
  onDirtyChange,
}: {
  library: PrivateLibrary;
  organization: UseQueryResult<
    z.infer<typeof organizationSnapshotSchema>,
    Error
  >;
  collectionId: string | null;
  onSelect: (id: string | null) => void;
  onAccepted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const [managing, setManaging] = useState(false);
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
        <CollectionManager
          library={library}
          collections={collections}
          textBytes={organization.data?.textBytes ?? 0}
          loading={organization.isPending}
          error={error}
          onRetry={refresh}
          onAccepted={onAccepted}
          onClose={() => {
            onDirtyChange(false);
            setManaging(false);
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
            setManaging(true);
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
    </section>
  );
};
