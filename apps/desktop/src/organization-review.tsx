import type {
  LocalOrganization,
  OrganizationLocalImpact,
  OrganizationLocalReview,
} from "@pr0/api-contract/local-organization";
import { useEffect, useState } from "react";

import { organizationClient } from "./organization-client";

export const OrganizationReview = ({
  operationId,
  effect,
  snapshot,
}: {
  operationId: string;
  effect: OrganizationLocalImpact["effect"];
  snapshot: LocalOrganization;
}) => {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [review, setReview] = useState<OrganizationLocalReview>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const value = await organizationClient.review(operationId, offset);
        if (!cancelled) {
          setReview(value);
          setError("");
        }
      } catch {
        if (!cancelled) {
          setError("Could not refresh the affected prompts.");
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new native snapshot invalidates current states of the original affected identities.
  }, [operationId, offset, open, snapshot]);
  return (
    <section
      aria-label="Organization result"
      className="space-y-2 rounded border p-3"
    >
      <p>
        “{effect.sourceName}”{" "}
        {effect.kind === "tag.merge"
          ? `merged into “${effect.targetName}”`
          : "deleted"}
        . {effect.activeCount} active and {effect.archivedCount} archived
        prompts affected. Your prompts were kept. Saved on this device.
      </p>
      <button
        type="button"
        className="rounded border p-2"
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
            Original affected identities; current state is shown. Later changes
            are separate from this operation.
          </p>
          <p role="alert">{error}</p>
          {[false, true].map((archived) => (
            <section
              key={String(archived)}
              aria-label={archived ? "Archived prompts" : "Active prompts"}
            >
              <h3>{archived ? "Archived prompts" : "Active prompts"}</h3>
              <ul className="max-h-48 overflow-y-auto">
                {review?.prompts.map((entry) =>
                  (entry.current?.archived ?? entry.originallyArchived) ===
                  archived ? (
                    <li key={entry.id}>
                      {entry.current
                        ? `${entry.current.title} · ${snapshot.collections.find((collection) => collection.id === entry.current?.collectionId)?.name ?? "Unassigned"}`
                        : "Prompt subsequently deleted"}
                    </li>
                  ) : null
                )}
              </ul>
            </section>
          ))}
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Previous affected prompts
          </button>
          <button
            type="button"
            disabled={
              review?.nextOffset === null || review?.nextOffset === undefined
            }
            onClick={() => setOffset(review?.nextOffset ?? offset)}
          >
            Next affected prompts
          </button>
        </>
      ) : null}
    </section>
  );
};
