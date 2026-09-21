import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { DesktopUsageStatus } from "@pr0/api-contract/desktop-copy";
import type { LocalOrganization } from "@pr0/api-contract/local-organization";
import type {
  LocalPrompt,
  UploadStatus,
} from "@pr0/api-contract/local-prompts";
import { useCallback, useEffect, useRef, useState } from "react";

import { DownloadedStatus } from "./downloaded-status";
import { downloadError, libraryClient } from "./library-client";
import type { DownloadStatus } from "./library-client";
import { DownloadControls } from "./local-library-status";
import { LocalPromptDetail } from "./local-prompt-detail";
import { LocalPromptEditor } from "./local-prompt-editor";
import { organizationClient } from "./organization-client";
import { PromptOrganization } from "./organization-controls";
import { RecoveryLibrary } from "./recovery-library";
import { SearchLibrary } from "./search-library";
import type { Status } from "./use-auth-session";
import { useLibraryRefresh } from "./use-library-refresh";
import { useLifecycle } from "./use-lifecycle";
import { usePromptCopy } from "./use-prompt-copy";

const editorIsBlocked = (editing: boolean, transition: boolean) =>
  editing || transition;

const useDownloadedLibrary = ({
  signedIn,
  refreshAuth,
  account,
}: {
  account: Status;
  signedIn: boolean;
  refreshAuth: (command: "auth_status") => Promise<Status | undefined>;
  editingDisabled: boolean;
  onEditing: (editing: boolean) => void;
}) => {
  const [snapshot, setSnapshot] = useState<{
    status?: DownloadStatus;
    upload?: UploadStatus;
    changes?: ChangeStatus;
    usage?: DesktopUsageStatus;
    organization?: LocalOrganization;
  }>({});
  const { status, upload, changes, usage, organization } = snapshot;
  const [localDetail, setLocalDetail] = useState<LocalPrompt>();
  const [editor, setEditor] = useState<{ initial?: LocalPrompt }>();
  const [errorText, setErrorText] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const refreshLibrary = useCallback(() => setRetry((value) => value + 1), []);
  const copy = usePromptCopy(account, refreshLibrary);
  useLibraryRefresh(refreshLibrary);
  const alive = useRef(true);
  const selection = useRef(0);
  const selectedPrompt = useRef<string | null>(null);
  const openedCopy = useRef<string | null>(null);
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
          openedCopy.current = null;
          selectedPrompt.current = null;
          setLocalDetail(undefined);
        }
        setErrorText(downloadError(error));
      }
    }
  }, []);
  const lifecycle = useLifecycle(account, (id, action) => {
    if (action.kind === "duplicate" || openedCopy.current !== id) {
      openedCopy.current = action.kind === "duplicate" ? id : null;
    }
    if (id) {
      void open(id);
    } else {
      selectedPrompt.current = null;
      selection.current += 1;
      setLocalDetail(undefined);
    }
    refreshLibrary();
  });
  const organizationSaved = useCallback(async () => {
    const nextOrganization = await organizationClient.snapshot();
    if (alive.current) {
      setSnapshot((previous) => ({
        ...previous,
        organization: nextOrganization,
      }));
      refreshLibrary();
    }
  }, [refreshLibrary]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [next, sync, incoming, uses, organizationSnapshot] =
        await Promise.all([
          libraryClient.status(),
          libraryClient.uploadStatus(),
          libraryClient.changeStatus(),
          libraryClient.usageStatus(),
          organizationClient.snapshot(),
        ]);
      if (!cancelled) {
        setSnapshot({
          status: next,
          upload: sync,
          changes: incoming,
          usage: uses,
          organization: organizationSnapshot,
        });
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
    async (
      id: string | null,
      reason: "refresh" | "navigation" = "navigation"
    ) => {
      if (reason === "refresh" && openedCopy.current) {
        return;
      }
      openedCopy.current = null;
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
        setSnapshot((previous) => ({ ...previous, usage: result }));
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
      const result = await libraryClient.upload();
      setSnapshot((previous) => ({ ...previous, upload: result }));
      setRetry((value) => value + 1);
    } catch {
      setRetry((value) => value + 1);
    }
  };
  const pauseDownload = async () => {
    try {
      const result = await libraryClient.pauseDownload(!status?.paused);
      setSnapshot((previous) => ({ ...previous, status: result }));
      refreshLibrary();
    } catch {
      setErrorText(
        "Could not change download state. Retry; local work is retained."
      );
    }
  };
  const promptSaved = (value: LocalPrompt) => {
    selectedPrompt.current = value.prompt.id;
    selection.current += 1;
    setEditor(undefined);
    setLocalDetail(value);
    setRetry((count) => count + 1);
  };
  return {
    status,
    upload,
    changes,
    localDetail,
    setLocalDetail,
    editor,
    setEditor,
    errorText,
    offline,
    busy,
    setRetry,
    usage,
    organization,
    copy,
    open,
    organizationSaved,
    retryUsage,
    retryUpload,
    pauseDownload,
    refreshLibrary,
    retry,
    selectResult,
    promptSaved,
    lifecycle,
  };
};
interface LibraryProps {
  account: Status;
  signedIn: boolean;
  refreshAuth: (command: "auth_status") => Promise<Status | undefined>;
  editingDisabled: boolean;
  onEditing: (editing: boolean) => void;
}
export const DownloadedLibrary = (props: LibraryProps) => {
  const { account, signedIn, editingDisabled, onEditing } = props;
  const {
    status,
    upload,
    changes,
    localDetail,
    editor,
    setEditor,
    errorText,
    offline,
    busy,
    usage,
    organization,
    copy,
    open,
    organizationSaved,
    retryUsage,
    retryUpload,
    pauseDownload,
    refreshLibrary,
    retry,
    selectResult,
    promptSaved,
    lifecycle,
  } = useDownloadedLibrary(props);
  return (
    <section aria-label="Downloaded library" className="space-y-4">
      <h2 className="text-xl font-semibold">Downloaded library</h2>
      <DownloadedStatus
        status={status}
        upload={upload}
        changes={changes}
        usage={usage}
        account={account}
        lifecycle={lifecycle}
        signedIn={signedIn}
        offline={offline}
        editing={editingDisabled || Boolean(editor)}
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
            promptSaved(value);
            onEditing(false);
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
        organization={organization}
        onOrganizationSaved={organizationSaved}
        editingDisabled={editorIsBlocked(Boolean(editor), editingDisabled)}
        onEditing={onEditing}
        onFavorite={lifecycle.handleFavorite}
        changing={lifecycle.busy || Boolean(editor) || editingDisabled}
        onSelect={selectResult}
        onCopy={copy.handleCopy}
        copying={copy.busy || editingDisabled}
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
          copying={copy.busy || editingDisabled || busy}
          onCopy={() => {
            void copy.handleCopy(localDetail.prompt.id);
          }}
        />
      ) : null}
      {localDetail && organization ? (
        <PromptOrganization
          account={account}
          value={localDetail}
          snapshot={organization}
          onSaved={organizationSaved}
          disabled={editorIsBlocked(Boolean(editor), editingDisabled)}
        />
      ) : null}
    </section>
  );
};
