import type { LocalOrganization } from "@pr0/api-contract/local-organization";
import { localConflictReviewSchema } from "@pr0/api-contract/local-prompts";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import { organizationError } from "./organization-client";
import { OrganizationManager } from "./organization-manager";
import { CapacityDetails } from "./rejected-change";
import type { Status } from "./use-auth-session";

export const OrganizationAttention = ({
  account,
  snapshot,
  onSaved,
  disabled,
  onEditing,
}: {
  account: Status;
  snapshot: LocalOrganization;
  onSaved: () => Promise<void>;
  disabled: boolean;
  onEditing: (value: boolean) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const retry = async (entry: LocalOrganization["pending"][number]) => {
    if (!("noticeId" in entry.operation)) {
      return;
    }
    try {
      await invoke(
        entry.operation.kind === "conflict.review"
          ? "library_review_conflict"
          : "library_review_adjustment",
        {
          request: localConflictReviewSchema.parse({
            instanceId: account.instanceId,
            accountId: account.accountId,
            generation: account.generation,
            noticeId: entry.operation.noticeId,
          }),
        }
      );
      setMessage("Review queued for retry. Prompt text is retained.");
      await onSaved();
    } catch {
      setMessage("Could not retry the review. Local work is retained.");
    }
  };
  const rejected = snapshot.pending.filter((entry) => entry.error);
  if (!rejected.length && !open) {
    return null;
  }
  return (
    <section aria-label="Organization changes need attention">
      <h3>Changes need attention</h3>
      <output>{message}</output>
      <p>
        Organization changes are saved on this device. Dependent prompts wait;
        unrelated work continues synchronizing.
      </p>
      <ul>
        {rejected.map((entry) => (
          <li key={entry.id}>
            {"name" in entry.operation
              ? entry.operation.name
              : entry.operation.kind}
            : {organizationError(entry.error)}
            <CapacityDetails failure={entry.failure} />
            {entry.operation.kind.endsWith(".review") ? (
              <>
                <p>
                  Review acknowledgement is waiting; reviewing never removes
                  prompt text.
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    void retry(entry);
                  }}
                >
                  Retry review
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          onEditing(true);
        }}
      >
        Rename or correct organization
      </button>
      {open ? (
        <OrganizationManager
          account={account}
          snapshot={snapshot}
          initialTab="collections"
          onSaved={onSaved}
          onClose={() => {
            setOpen(false);
            onEditing(false);
          }}
        />
      ) : null}
    </section>
  );
};
