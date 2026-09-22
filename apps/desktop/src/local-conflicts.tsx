/* oxlint-disable react/exhaustive-effect-dependencies -- Native event counters and explicit retries invalidate the persisted notice query. */
import {
  localConflictReviewSchema,
  localConflictPageSchema as pageSchema,
} from "@pr0/api-contract/local-prompts";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";

import type { Status } from "./use-auth-session";

export const LocalConflicts = ({
  account,
  refresh,
  onOpen,
  onChanged,
}: {
  account: Status;
  refresh: number;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) => {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<z.infer<typeof pageSchema>>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = pageSchema.parse(
          await invoke("library_conflicts", { offset })
        );
        if (
          result.instanceId !== account.instanceId ||
          result.accountId !== account.accountId
        ) {
          return;
        }
        if (!cancelled) {
          setPage(result);
          setError(
            result.error
              ? "Could not refresh conflict notices. Previously downloaded reviews remain available. Synchronization will retry."
              : ""
          );
        }
      } catch {
        if (!cancelled) {
          setError(
            "Could not load conflict review. Saved prompts remain available."
          );
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
    refresh,
    version,
  ]);
  const review = async (noticeId: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await invoke("library_review_conflict", {
        request: localConflictReviewSchema.parse({
          instanceId: account.instanceId,
          accountId: account.accountId,
          generation: account.generation,
          noticeId,
        }),
      });
      summary.current?.focus();
      setMessage(
        "Review saved on this device. Prompts and retained titles were kept."
      );
      setVersion((value) => value + 1);
      onChanged();
    } catch {
      setMessage(
        "Review was not saved. Prompts remain available; retry the review."
      );
    }
    setBusy(false);
  };
  if (!page?.notices.length && !error && !message && !offset) {
    return null;
  }
  return (
    <details className="wf-notice" data-tone="attention">
      <summary ref={summary}>Conflicts to review</summary>
      <p>
        Competing edits were preserved independently. Reviewing keeps the text;
        it does not dismiss blocked uploads.
      </p>
      <output>{message}</output>
      {error ? (
        <p>
          {error}{" "}
          <button
            type="button"
            onClick={() => setVersion((value) => value + 1)}
          >
            Retry conflict review
          </button>
        </p>
      ) : null}
      <ul className="space-y-3">
        {page?.notices.map((notice) => (
          <li key={notice.id} className="rounded border p-3">
            <p className="break-words whitespace-pre-wrap">
              Full source title: {notice.sourceTitle}
            </p>
            <p>
              Preserved{" "}
              <time dateTime={notice.createdAt}>
                {new Date(notice.createdAt).toLocaleString()}
              </time>
            </p>
            {notice.originalDeleted ? (
              <p>Original permanently deleted.</p>
            ) : (
              <>
                {notice.originalArchived ? <p>Original archived.</p> : null}
                {notice.originalAvailable ? (
                  <button
                    type="button"
                    onClick={() => onOpen(notice.originalId)}
                  >
                    Open original
                  </button>
                ) : (
                  <p>Original is not available on this device yet.</p>
                )}
              </>
            )}
            {notice.copyAvailable ? (
              <button type="button" onClick={() => onOpen(notice.copyId)}>
                Open conflict copy
              </button>
            ) : (
              <p>
                Conflict copy is not available on this device yet. Finish
                downloading to open it.
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void review(notice.id);
              }}
            >
              {notice.originalDeleted ? "Mark reviewed" : "Keep both"}
            </button>
          </li>
        ))}
      </ul>
      {offset ? (
        <button
          type="button"
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous conflicts
        </button>
      ) : null}
      {page?.nextOffset !== null && page?.nextOffset !== undefined ? (
        <button
          type="button"
          onClick={() => setOffset(page.nextOffset ?? offset)}
        >
          More conflicts
        </button>
      ) : null}
    </details>
  );
};
