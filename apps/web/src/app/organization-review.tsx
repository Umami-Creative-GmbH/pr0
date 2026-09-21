"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { organizationEffectSchema } from "@pr0/api-contract/prompts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";

const groups = [
  { label: "Active prompts", archived: false },
  { label: "Archived prompts", archived: true },
];

export const OrganizationReview = ({
  library,
  operationId,
  effect,
}: {
  library: PrivateLibrary;
  operationId: string;
  effect: z.infer<typeof organizationEffectSchema>;
}) => {
  const client = useApiClient();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const scope = {
    instanceId: library.instance.id,
    accountId: library.account.id,
  };
  const review = useQuery({
    queryKey: ["organization-review", scope, operationId, offset],
    enabled: open,
    queryFn: ({ signal }) =>
      client.getOrganizationReview(operationId, offset, signal, scope),
    refetchInterval: 5000,
  });
  const organization = useQuery({
    queryKey: ["organization-review-names", scope],
    enabled: open,
    queryFn: ({ signal }) => client.getOrganization(signal, scope),
    refetchInterval: 5000,
  });
  const nextOffset = review.data?.nextOffset ?? null;
  return (
    <section
      aria-label="Organization result"
      className="space-y-2 rounded-md border p-3"
    >
      <output>
        {effect.kind === "tag.merge"
          ? `Tag “${effect.sourceName}” merged into “${effect.targetName}”.`
          : `${effect.kind === "collection.delete" ? "Collection" : "Tag"} “${effect.sourceName}” deleted.`}{" "}
        {effect.activeCount} active prompts and {effect.archivedCount} archived
        prompts{" "}
        {effect.kind === "collection.delete"
          ? "became unassigned"
          : "had their tag assignments changed"}
        . Your prompts were kept. Saved to server.
      </output>
      <button
        type="button"
        className="wf-btn"
        onClick={() => {
          setOffset(0);
          setOpen(!open);
        }}
      >
        Review affected prompts
      </button>
      {open ? (
        <>
          <p>
            Original affected identities; current state is shown below. Later
            changes are separate from this operation.
          </p>
          {review.isPending ? <output>Loading affected prompts…</output> : null}
          {review.isError ? (
            <p role="alert">
              Could not refresh the review.{" "}
              <button
                type="button"
                onClick={() => {
                  void review.refetch();
                }}
              >
                Retry review
              </button>
            </p>
          ) : null}
          <div className="max-h-72 overflow-y-auto">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h4 className="font-semibold">{group.label}</h4>
                <ul>
                  {review.data?.prompts.map((entry) =>
                    entry.current?.archived === group.archived ? (
                      <li key={entry.id} className="border-b py-2 break-words">
                        {entry.current?.title} ·{" "}
                        {entry.current?.collectionId
                          ? `Collection: ${organization.data?.collections.find((collection) => collection.id === entry.current?.collectionId)?.name ?? "Unavailable"}`
                          : "Unassigned"}{" "}
                        · Tags:{" "}
                        {entry.current?.tagIds
                          .map(
                            (id) =>
                              organization.data?.tags.find(
                                (tag) => tag.id === id
                              )?.name ?? "Unavailable"
                          )
                          .join(", ") || "None"}
                      </li>
                    ) : null
                  )}
                </ul>
              </section>
            ))}
            <section aria-label="Deleted prompts">
              <h4 className="font-semibold">Deleted since this operation</h4>
              <ul>
                {review.data?.prompts.map((entry) =>
                  entry.current ? null : (
                    <li key={entry.id}>
                      {entry.id} · originally{" "}
                      {entry.originallyArchived ? "archived" : "active"}
                    </li>
                  )
                )}
              </ul>
            </section>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous affected prompts
            </button>
            <button
              type="button"
              disabled={nextOffset === null}
              onClick={() => {
                if (nextOffset !== null) {
                  setOffset(nextOffset);
                }
              }}
            >
              Next affected prompts
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
};
