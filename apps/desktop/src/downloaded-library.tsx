import type { Prompt } from "@pr0/api-contract/prompts";
import { useCallback, useEffect, useRef, useState } from "react";

import { downloadError, libraryClient } from "./library-client";
import type { DownloadedSummary, DownloadStatus } from "./library-client";

export const DownloadedLibrary = ({
  signedIn,
  refreshAuth,
}: {
  signedIn: boolean;
  refreshAuth: (command: "auth_status") => Promise<void>;
}) => {
  const [status, setStatus] = useState<DownloadStatus>();
  const [rows, setRows] = useState<DownloadedSummary[]>([]);
  const [detail, setDetail] = useState<Prompt>();
  const [offset, setOffset] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  const selection = useRef(0);
  const browseRequest = useRef(0);
  const currentOffset = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const requestedOffset = currentOffset.current;
      const [next, prompts] = await Promise.all([
        libraryClient.status(),
        libraryClient.browse(requestedOffset),
      ]);
      if (!cancelled) {
        setStatus(next);
        if (requestedOffset === currentOffset.current) {
          setRows(prompts);
        }
      }
      return next;
    };
    const start = async () => {
      setErrorText("");
      setBusy(true);
      try {
        let next = await refresh();
        // Each native command commits one bounded page before progress changes.
        // oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Sequential page acknowledgements are required for durable progress.
        while (!next.complete) {
          if (cancelled || !signedIn) {
            break;
          }
          await libraryClient.download();
          next = await refresh();
        }
        // oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop
      } catch (error) {
        if (!cancelled) {
          setErrorText(downloadError(error));
          if (error === "authentication_required") {
            await refreshAuth("auth_status");
          }
        }
      }
      if (!cancelled) {
        setBusy(false);
      }
    };
    void start();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- An explicit Retry restarts this effect even when sign-in state is unchanged.
  }, [signedIn, retry, refreshAuth]);
  const browse = useCallback(async (next: number) => {
    browseRequest.current += 1;
    const request = browseRequest.current;
    try {
      const prompts = await libraryClient.browse(next);
      if (alive.current && request === browseRequest.current) {
        currentOffset.current = next;
        setOffset(next);
        setRows(prompts);
      }
    } catch (error) {
      if (alive.current) {
        setErrorText(downloadError(error));
      }
    }
  }, []);
  const open = useCallback(async (id: string) => {
    selection.current += 1;
    const request = selection.current;
    try {
      const prompt = await libraryClient.detail(id);
      if (alive.current && request === selection.current) {
        setDetail(prompt);
      }
    } catch (error) {
      if (alive.current) {
        setErrorText(downloadError(error));
      }
    }
  }, []);
  return (
    <section aria-label="Downloaded library" className="space-y-4">
      <h2 className="text-xl font-semibold">Downloaded library</h2>
      <output className="block">
        {status?.complete
          ? `Library downloaded at revision ${status.revision}. Available offline.`
          : `Downloading library: ${status?.downloaded ?? 0} prompts available. The offline library is incomplete.`}
      </output>
      {status && status.totalPages > 0 ? (
        <progress
          aria-label="Library download progress"
          max={status.totalPages}
          value={status.appliedPages}
        />
      ) : null}
      {signedIn ? null : (
        <p>
          Sign in to resume downloading. Downloaded prompts remain available.
        </p>
      )}
      {errorText ? <p role="alert">{errorText}</p> : null}
      {!status?.complete && signedIn ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRetry((value) => value + 1);
          }}
          className="rounded border px-4 py-2"
        >
          Retry download
        </button>
      ) : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              className="rounded border px-3 py-2 text-left"
              onClick={() => {
                void open(row.id);
              }}
              type="button"
            >
              {row.title}
              {row.archived ? " (Archived)" : ""}
            </button>
          </li>
        ))}
      </ul>
      {status?.complete && status.downloaded === 0 ? (
        <p>Your library is empty.</p>
      ) : null}
      <nav aria-label="Downloaded prompt pages" className="flex gap-4">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => {
            void browse(Math.max(0, offset - 50));
          }}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={offset + rows.length >= (status?.downloaded ?? 0)}
          onClick={() => {
            void browse(offset + 50);
          }}
        >
          Next
        </button>
      </nav>
      {detail ? (
        <article
          aria-label="Prompt detail"
          className="space-y-3 rounded border p-4"
        >
          <h3 className="text-lg font-semibold">{detail.title}</h3>
          {detail.description ? (
            <p className="whitespace-pre-wrap">{detail.description}</p>
          ) : null}
          <label className="block" htmlFor="downloaded-content">
            Prompt content
          </label>
          <textarea
            className="min-h-48 w-full rounded border p-3"
            id="downloaded-content"
            readOnly
            value={detail.content}
          />
        </article>
      ) : null}
    </section>
  );
};
