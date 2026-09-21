import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { DesktopUsageStatus } from "@pr0/api-contract/desktop-copy";
import type {
  LocalPrompt,
  LocalView,
  UploadStatus,
} from "@pr0/api-contract/local-prompts";
import { useCallback, useEffect, useRef, useState } from "react";

import { DownloadedRows } from "./downloaded-rows";
import { DownloadedStatus } from "./downloaded-status";
import { downloadError, libraryClient } from "./library-client";
import type { DownloadedSummary, DownloadStatus } from "./library-client";
import { LibraryViews } from "./library-views";
import { LocalPromptDetail } from "./local-prompt-detail";
import { LocalPromptEditor } from "./local-prompt-editor";
import type { Status } from "./use-auth-session";
import { useLibraryRefresh } from "./use-library-refresh";
import { useLifecycle } from "./use-lifecycle";
import { usePromptCopy } from "./use-prompt-copy";

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
  const [changes, setChanges] = useState<ChangeStatus>();
  const [rows, setRows] = useState<DownloadedSummary[]>([]);
  const [localDetail, setLocalDetail] = useState<LocalPrompt>();
  const [editor, setEditor] = useState<{ initial?: LocalPrompt }>();
  const [offset, setOffset] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [usage, setUsage] = useState<DesktopUsageStatus>();
  const [view, setView] = useState<LocalView>("all");
  const recents = view === "recents";
  const refreshLibrary = useCallback(() => setRetry((value) => value + 1), []);
  const copy = usePromptCopy(account, refreshLibrary);
  useLibraryRefresh(refreshLibrary);
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
      if (alive.current && request === selection.current) {
        if (error === "prompt_not_found" || error === "prompt_unavailable") {
          selectedPrompt.current = null;
          setLocalDetail(undefined);
        }
        setErrorText(downloadError(error));
      }
    }
  }, []);
  const lifecycle = useLifecycle(account, (id) => {
    if (id) {
      void open(id);
    } else {
      selectedPrompt.current = null;
      selection.current += 1;
      setLocalDetail(undefined);
    }
    refreshLibrary();
  });
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
      const [next, prompts, sync, incoming, uses] = await Promise.all([
        libraryClient.status(),
        libraryClient.list(requestedOffset, view),
        libraryClient.uploadStatus(),
        libraryClient.changeStatus(),
        libraryClient.usageStatus(),
      ]);
      if (!cancelled) {
        setStatus(next);
        setUpload(sync);
        setChanges(incoming);
        setUsage(uses);
        if (
          sync.error === "authentication_required" ||
          uses.error === "authentication_required"
        ) {
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
  }, [signedIn, retry, refreshAuth, open, view]);
  const browse = useCallback(
    async (next: number) => {
      browseRequest.current += 1;
      const request = browseRequest.current;
      try {
        const prompts = await libraryClient.list(next, view);
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
    },
    [view]
  );
  const retryUsage = async () => {
    try {
      const result = await libraryClient.retryUsage();
      if (alive.current) {
        setUsage(result);
        copy.usageRetried();
        setErrorText("");
        setRetry((value) => value + 1);
      }
    } catch {
      if (alive.current) {
        setErrorText(
          "Usage still could not be saved. Free disk space and retry usage; the clipboard is unchanged."
        );
      }
    }
  };
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
      <LibraryViews
        view={view}
        onSelect={(value) => {
          if (value === view) {
            return;
          }
          browseRequest.current += 1;
          currentOffset.current = 0;
          setOffset(0);
          setRows([]);
          setView(value);
        }}
      />
      <DownloadedStatus
        status={status}
        upload={upload}
        changes={changes}
        usage={usage}
        account={account}
        lifecycle={lifecycle}
        signedIn={signedIn}
        offline={offline}
        busy={busy}
        editing={editingDisabled || Boolean(editor)}
        error={errorText}
        copyMessage={copy.message}
        onRetry={refreshLibrary}
        onRetryUsage={() => {
          void retryUsage();
        }}
        onRetryUpload={() => {
          void retryUpload();
        }}
        onOpen={(id) => {
          void open(id);
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
      <DownloadedRows
        rows={rows}
        offset={offset}
        recents={recents}
        copying={copy.busy || editingDisabled}
        onOpen={open}
        onCopy={copy.handleCopy}
        onBrowse={browse}
        onFavorite={lifecycle.handleFavorite}
        changing={lifecycle.busy || Boolean(editor) || editingDisabled}
      />
      {localDetail ? (
        <LocalPromptDetail
          value={localDetail}
          editing={
            editorIsBlocked(Boolean(editor), editingDisabled) || lifecycle.busy
          }
          onAction={lifecycle.handleAction}
          onEdit={() => {
            setEditor({ initial: localDetail });
            onEditing(true);
          }}
          copying={copy.busy || editingDisabled}
          onCopy={() => {
            void copy.handleCopy(localDetail.prompt.id);
          }}
        />
      ) : null}
    </section>
  );
};
