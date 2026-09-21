import type {
  LocalPrompt,
  UploadStatus,
} from "@pr0/api-contract/local-prompts";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { downloadError, libraryClient } from "./library-client";
import type { DownloadedSummary, DownloadStatus } from "./library-client";
import { LocalLibraryStatus } from "./local-library-status";
import { LocalPromptDetail } from "./local-prompt-detail";
import { LocalPromptEditor } from "./local-prompt-editor";
import type { Status } from "./use-auth-session";

const editorIsBlocked = (editing: boolean, transition: boolean) =>
  editing || transition;

export const DownloadedLibrary = ({
  signedIn,
  refreshAuth,
  account,
  editingDisabled,
  onEditing,
}: {
  account: Status;
  signedIn: boolean;
  refreshAuth: (command: "auth_status") => Promise<Status | undefined>;
  editingDisabled: boolean;
  onEditing: (editing: boolean) => void;
}) => {
  const [status, setStatus] = useState<DownloadStatus>();
  const [upload, setUpload] = useState<UploadStatus>();
  const [rows, setRows] = useState<DownloadedSummary[]>([]);
  const [localDetail, setLocalDetail] = useState<LocalPrompt>();
  const [editor, setEditor] = useState<{ initial?: LocalPrompt }>();
  const [offset, setOffset] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  const selection = useRef(0);
  const browseRequest = useRef(0);
  const currentOffset = useRef(0);
  const selectedPrompt = useRef<string | null>(null);
  const observedMappings = useRef(new Set<string>());
  const open = useCallback(async (id: string) => {
    selectedPrompt.current = id;
    selection.current += 1;
    const request = selection.current;
    try {
      const value = await libraryClient.editor(id);
      if (alive.current && request === selection.current) {
        setLocalDetail(value);
      }
    } catch (error) {
      if (alive.current) {
        setErrorText(downloadError(error));
      }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const refresh = () => setRetry((value) => value + 1);
    const subscribe = async () => {
      try {
        const unlisten = await listen("library-changed", refresh);
        if (disposed) {
          unlisten();
        } else {
          stop = unlisten;
        }
      } catch {
        // Focus and explicit retry still refresh authoritative state if event registration fails.
      }
    };
    void subscribe();
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const requestedOffset = currentOffset.current;
      const [next, prompts, sync] = await Promise.all([
        libraryClient.status(),
        libraryClient.browse(requestedOffset),
        libraryClient.uploadStatus(),
      ]);
      if (!cancelled) {
        setStatus(next);
        setUpload(sync);
        if (sync.error === "authentication_required") {
          await refreshAuth("auth_status");
        }
        if (requestedOffset === currentOffset.current) {
          setRows(prompts);
        }
        if (selectedPrompt.current) {
          const mapping = sync.mappings.find(
            (entry) =>
              entry.originalId === selectedPrompt.current &&
              !observedMappings.current.has(entry.copyId)
          );
          await open(mapping?.copyId ?? selectedPrompt.current);
        }
        for (const mapping of sync.mappings) {
          observedMappings.current.add(mapping.copyId);
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
          setOffline(error === "network_unavailable");
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
  }, [signedIn, retry, refreshAuth, open]);
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
  const retryUpload = async () => {
    try {
      setUpload(await libraryClient.upload());
    } catch {
      setRetry((value) => value + 1);
    }
  };
  return (
    <section aria-label="Downloaded library" className="space-y-4">
      <h2 className="text-xl font-semibold">Downloaded library</h2>
      <LocalLibraryStatus
        status={status}
        signedIn={signedIn}
        offline={offline}
        upload={upload}
        onOpen={(id) => {
          void open(id);
        }}
        onRetry={() => {
          void retryUpload();
        }}
      />
      <button
        type="button"
        className="rounded border px-4 py-2"
        disabled={editorIsBlocked(Boolean(editor), editingDisabled)}
        onClick={() => {
          setEditor({});
          onEditing(true);
        }}
      >
        New prompt
      </button>
      {editor ? (
        <LocalPromptEditor
          initial={editor.initial}
          mappings={upload?.mappings}
          onOpenOriginal={(id) => {
            void open(id);
          }}
          account={account}
          onCancel={() => {
            setEditor(undefined);
            onEditing(false);
          }}
          onSaved={(value) => {
            selectedPrompt.current = value.prompt.id;
            selection.current += 1;
            setEditor(undefined);
            onEditing(false);
            setLocalDetail(value);
            setRetry((count) => count + 1);
          }}
        />
      ) : null}
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
      {localDetail ? (
        <LocalPromptDetail
          value={localDetail}
          editing={editorIsBlocked(Boolean(editor), editingDisabled)}
          onEdit={() => {
            setEditor({ initial: localDetail });
            onEditing(true);
          }}
        />
      ) : null}
    </section>
  );
};
