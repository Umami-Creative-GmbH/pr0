import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { DesktopUsageStatus } from "@pr0/api-contract/desktop-copy";
import type {
  LocalPrompt,
  UploadStatus,
} from "@pr0/api-contract/local-prompts";
import { useCallback, useEffect, useRef, useState } from "react";

import { downloadError, libraryClient } from "./library-client";
import type { DownloadStatus } from "./library-client";
import { DownloadControls, LocalLibraryStatus } from "./local-library-status";
import { LocalPromptDetail } from "./local-prompt-detail";
import { LocalPromptEditor } from "./local-prompt-editor";
import { RecoveryLibrary } from "./recovery-library";
import { SearchLibrary } from "./search-library";
import { UsageStatus } from "./usage-status";
import type { Status } from "./use-auth-session";
import { useLibraryRefresh } from "./use-library-refresh";
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
  const [localDetail, setLocalDetail] = useState<LocalPrompt>();
  const [editor, setEditor] = useState<{ initial?: LocalPrompt }>();
  const [errorText, setErrorText] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [usage, setUsage] = useState<DesktopUsageStatus>();
  const refreshLibrary = useCallback(() => setRetry((value) => value + 1), []);
  const copy = usePromptCopy(account, refreshLibrary);
  useLibraryRefresh(refreshLibrary);
  const alive = useRef(true);
  const selection = useRef(0);
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
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [next, sync, incoming, uses] = await Promise.all([
        libraryClient.status(),
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
        while (!next.complete && !next.paused) {
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
  const selectResult = useCallback(
    async (id: string | null) => {
      if (id) {
        await open(id);
      } else {
        selectedPrompt.current = null;
        selection.current += 1;
        setLocalDetail(undefined);
      }
    },
    [open]
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
      await libraryClient.sync();
      setUpload(await libraryClient.upload());
      setRetry((value) => value + 1);
    } catch {
      setRetry((value) => value + 1);
    }
  };
  const pauseDownload = async () => {
    try {
      setStatus(await libraryClient.pauseDownload(!status?.paused));
      refreshLibrary();
    } catch {
      setErrorText(
        "Could not change download state. Retry; local work is retained."
      );
    }
  };
  return (
    <section aria-label="Downloaded library" className="space-y-4">
      <h2 className="text-xl font-semibold">Downloaded library</h2>
      <output>{copy.message}</output>
      <UsageStatus
        status={usage}
        onRetry={() => {
          void retryUsage();
        }}
      />
      <LocalLibraryStatus
        status={status}
        signedIn={signedIn}
        offline={offline}
        upload={upload}
        changes={changes}
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
      <DownloadControls
        status={status}
        signedIn={signedIn}
        busy={busy}
        errorText={errorText}
        onPause={() => {
          void pauseDownload();
        }}
        onRetry={refreshLibrary}
      />
      {status?.recoveryCount ? (
        <RecoveryLibrary count={status.recoveryCount} account={account} />
      ) : null}
      <SearchLibrary
        account={account}
        refresh={retry}
        onSelect={selectResult}
        onCopy={copy.handleCopy}
        copying={copy.busy || editingDisabled}
      />
      {localDetail ? (
        <LocalPromptDetail
          value={localDetail}
          editing={editorIsBlocked(Boolean(editor), editingDisabled)}
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
