import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { DesktopUsageStatus } from "@pr0/api-contract/desktop-copy";
import type { LocalOrganization } from "@pr0/api-contract/local-organization";
import type {
  LocalPrompt,
  UploadStatus,
} from "@pr0/api-contract/local-prompts";
import { useCallback, useEffect, useRef, useState } from "react";

import { DownloadedRows } from "./downloaded-rows";
import { downloadError, libraryClient } from "./library-client";
import type { DownloadedSummary, DownloadStatus } from "./library-client";
import { LibraryViews } from "./library-views";
import { DownloadProgress, LocalLibraryStatus } from "./local-library-status";
import { LocalPromptDetail } from "./local-prompt-detail";
import { LocalPromptEditor } from "./local-prompt-editor";
import { organizationClient } from "./organization-client";
import {
  OrganizationControls,
  PromptOrganization,
} from "./organization-controls";
import type { OrganizationFilters } from "./organization-controls";
import { UsageStatus } from "./usage-status";
import type { Status } from "./use-auth-session";
import { useLibraryRefresh } from "./use-library-refresh";
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
  const [rows, setRows] = useState<DownloadedSummary[]>([]);
  const [localDetail, setLocalDetail] = useState<LocalPrompt>();
  const [editor, setEditor] = useState<{ initial?: LocalPrompt }>();
  const [offset, setOffset] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [recents, setRecents] = useState(false);
  const [filters, setFilters] = useState<OrganizationFilters>({
    collectionId: null,
    tagIds: [],
  });
  const refreshLibrary = useCallback(() => setRetry((value) => value + 1), []);
  const copy = usePromptCopy(account, refreshLibrary);
  useLibraryRefresh(refreshLibrary);
  const alive = useRef(true);
  const selection = useRef(0);
  const browseRequest = useRef(0);
  const currentOffset = useRef(0);
  const selectedPrompt = useRef<string | null>(null);
  const observedMappings = useRef(new Set<string>());
  const open = useCallback(
    async (id: string) => {
      selectedPrompt.current = id;
      selection.current += 1;
      const request = selection.current;
      try {
        const value = await libraryClient.editor(id);
        if (alive.current && request === selection.current) {
          const assignedTags = new Set(value.prompt.tagIds);
          const eligible =
            !value.prompt.archived &&
            (!filters.collectionId ||
              value.prompt.collectionId === filters.collectionId) &&
            filters.tagIds.every((tag) => assignedTags.has(tag));
          setLocalDetail(eligible ? value : undefined);
          if (!eligible) {
            selectedPrompt.current = null;
          }
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
    },
    [filters]
  );
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
      const requestedOffset = currentOffset.current;
      const [next, prompts, sync, incoming, uses, organizationSnapshot] =
        await Promise.all([
          libraryClient.status(),
          organizationClient.browse(
            requestedOffset,
            recents,
            filters.collectionId,
            filters.tagIds
          ),
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
  }, [signedIn, retry, refreshAuth, open, recents, filters]);
  const browse = useCallback(
    async (next: number) => {
      browseRequest.current += 1;
      const request = browseRequest.current;
      try {
        const prompts = await organizationClient.browse(
          next,
          recents,
          filters.collectionId,
          filters.tagIds
        );
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
    [recents, filters]
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
      const result = await libraryClient.upload();
      setSnapshot((previous) => ({ ...previous, upload: result }));
    } catch {
      setRetry((value) => value + 1);
    }
  };
  const changeFilters = (next: OrganizationFilters) => {
    browseRequest.current += 1;
    currentOffset.current = 0;
    selectedPrompt.current = null;
    selection.current += 1;
    setLocalDetail(undefined);
    setOffset(0);
    setRows([]);
    setFilters(next);
  };
  const changeView = (value: boolean) => {
    if (value !== recents) {
      changeFilters({ collectionId: null, tagIds: [] });
      setRecents(value);
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
    rows,
    setRows,
    localDetail,
    setLocalDetail,
    editor,
    setEditor,
    offset,
    setOffset,
    errorText,
    offline,
    busy,
    setRetry,
    usage,
    recents,
    setRecents,
    organization,
    filters,
    setFilters,
    copy,
    open,
    organizationSaved,
    browse,
    retryUsage,
    retryUpload,
    changeFilters,
    changeView,
    promptSaved,
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
    rows,
    localDetail,
    editor,
    setEditor,
    offset,
    errorText,
    offline,
    busy,
    setRetry,
    usage,
    recents,
    organization,
    filters,
    copy,
    open,
    organizationSaved,
    browse,
    retryUsage,
    retryUpload,
    changeFilters,
    changeView,
    promptSaved,
  } = useDownloadedLibrary(props);
  return (
    <section aria-label="Downloaded library" className="space-y-4">
      <h2 className="text-xl font-semibold">Downloaded library</h2>
      <LibraryViews recents={recents} onSelect={changeView} />
      {organization ? (
        <OrganizationControls
          account={account}
          snapshot={organization}
          filters={filters}
          onFilters={changeFilters}
          onSaved={organizationSaved}
          disabled={editorIsBlocked(Boolean(editor), editingDisabled)}
          onEditing={onEditing}
        />
      ) : null}
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
            promptSaved(value);
            onEditing(false);
          }}
        />
      ) : null}
      <DownloadProgress status={status} signedIn={signedIn} />
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
      <DownloadedRows
        rows={rows}
        offset={offset}
        recents={recents}
        copying={copy.busy || editingDisabled || busy}
        onOpen={open}
        onCopy={copy.handleCopy}
        onBrowse={browse}
      />
      {localDetail ? (
        <LocalPromptDetail
          value={localDetail}
          editing={editorIsBlocked(Boolean(editor), editingDisabled)}
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
