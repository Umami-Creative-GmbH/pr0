/* oxlint-disable react/exhaustive-effect-dependencies -- Native event counters and explicit retries invalidate the persisted notice query. */
import {
  localConflictReviewSchema,
  localAdjustmentPageSchema as pageSchema,
} from "@pr0/api-contract/local-prompts";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";

import type { Status } from "./use-auth-session";

export const LocalAdjustments = ({
  account,
  refresh,
  onChanged,
}: {
  account: Status;
  refresh: number;
  onChanged: () => void;
}) => {
  const [page, setPage] = useState<z.infer<typeof pageSchema>>();
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = pageSchema.parse(
          await invoke("library_adjustments", { offset })
        );
        if (
          result.instanceId !== account.instanceId ||
          result.accountId !== account.accountId
        ) {
          return;
        }
        if (!cancelled) {
          setPage(result);
          setError(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    account.instanceId,
    account.accountId,
    account.generation,
    offset,
    version,
    refresh,
  ]);
  const review = async (noticeId: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await invoke("library_review_adjustment", {
        request: localConflictReviewSchema.parse({
          instanceId: account.instanceId,
          accountId: account.accountId,
          generation: account.generation,
          noticeId,
        }),
      });
      heading.current?.focus();
      setMessage(
        "Organization notice reviewed on this device. Your prompts were kept."
      );
      setVersion((value) => value + 1);
      onChanged();
    } catch {
      setMessage("Review was not saved. Retry; your prompts remain available.");
    }
    setBusy(false);
  };
  if (!page?.notices.length && !error && !message && !offset) {
    return null;
  }
  return (
    <section
      aria-label="Organization adjustments"
      className="space-y-3 rounded border p-3"
    >
      <h3 ref={heading} tabIndex={-1}>
        Organization adjustments to review
      </h3>
      <output>{message}</output>
      {error ? (
        <p>
          Could not load retained notices.{" "}
          <button
            type="button"
            onClick={() => setVersion((value) => value + 1)}
          >
            Retry notices
          </button>
        </p>
      ) : null}
      <ul>
        {page?.notices.map((notice) => (
          <li key={notice.id}>
            <p>{notice.message}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void review(notice.id);
              }}
            >
              Mark adjustment reviewed
            </button>
          </li>
        ))}
      </ul>
      {offset ? (
        <button
          type="button"
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous adjustments
        </button>
      ) : null}
      {page?.nextOffset !== null && page?.nextOffset !== undefined ? (
        <button
          type="button"
          onClick={() => setOffset(page.nextOffset ?? offset)}
        >
          More adjustments
        </button>
      ) : null}
    </section>
  );
};
