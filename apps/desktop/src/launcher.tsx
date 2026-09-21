import type { LauncherStatus } from "@pr0/api-contract/desktop-launcher";
import { organizationSearch } from "@pr0/api-contract/organization";
import { CollectionPicker } from "@pr0/ui/components/collection-picker";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import {
  ThemeToggle,
  WayfinderShell,
} from "@pr0/ui/components/wayfinder-shell";
import { accentFor } from "@pr0/ui/lib/present";
import { Search } from "lucide-react";
import { StrictMode, useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";

import { launcherClient } from "./launcher-client";
import { PromptVariables } from "./prompt-variables";
import { useLauncherStatus } from "./use-launcher-status";
import { useLocalSearch } from "./use-local-search";
import { usePromptCopy } from "./use-prompt-copy";

import "./styles.css";

const select = async () => {
  // Selection stays in the launcher; no detail fetch is needed.
};
const matches = (name: string, query: string) =>
  organizationSearch(name).includes(organizationSearch(query));

const LauncherFilters = ({
  search,
}: {
  search: ReturnType<typeof useLocalSearch>;
}) => (
  <details className="wf-launcher-filters">
    <summary>
      Filters
      {search.collectionId || search.tagIds.length || search.favorite
        ? " (active)"
        : ""}
    </summary>
    <div className="flex flex-col gap-3 pb-2">
      <CollectionPicker
        compact
        label="Collection filter"
        emptyLabel="All collections"
        collections={search.page?.collections ?? []}
        value={search.collectionId ?? null}
        onChange={(collectionId) =>
          search.changeFilters({ collectionId, tagIds: search.tagIds })
        }
        search={matches}
        unavailableName="Unavailable collection"
      />
      <TagPicker
        compact
        label="Tag filters"
        tags={search.page?.tags ?? []}
        value={search.tagIds}
        onChange={(tagIds) =>
          search.changeFilters({
            collectionId: search.collectionId ?? null,
            tagIds,
          })
        }
        search={matches}
      />
      <div className="wf-filter-row">
        <label className="wf-chip">
          <input
            type="checkbox"
            checked={search.favorite}
            onChange={(event) => search.changeFavorite(event.target.checked)}
          />
          Favorites only
        </label>
        <button
          className="wf-btn-quiet"
          type="button"
          onClick={() => search.clearFilters()}
        >
          Clear filters
        </button>
      </div>
    </div>
  </details>
);

const EmptyResults = ({
  search,
}: {
  search: ReturnType<typeof useLocalSearch>;
}) => {
  if (search.busy || search.error || search.page?.prompts.length) {
    return null;
  }
  return (
    <output className="wf-launcher-note">
      {search.restricted
        ? "No matching prompts"
        : "No active downloaded prompts. Open the library to add prompts."}
    </output>
  );
};

const LauncherSearch = ({
  status,
  revision,
  account,
}: {
  status: LauncherStatus;
  revision: number;
  account: NonNullable<LauncherStatus["account"]>;
}) => {
  const search = useLocalSearch(account, revision, select, "launcher");
  const input = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const copying = usePromptCopy(
    account,
    () => {
      // Native copy success hides this opening and publishes the library change.
    },
    status.opening
  );
  const { busy, message: copyMessage } = copying;
  useEffect(() => {
    if (status.focused && !copying.interaction) {
      input.current?.focus();
    }
  }, [status.focused, copying.interaction]);
  const copy = async (id: string) => {
    if (busy || search.busy) {
      return;
    }
    await copying.handleCopy(id);
  };
  const move = (event: KeyboardEvent, id?: string) => {
    if (search.busy) {
      return;
    }
    const prompts = search.page?.prompts ?? [];
    const index = prompts.findIndex((prompt) => prompt.id === id);
    const nextIndex =
      event.key === "ArrowDown"
        ? Math.min(index + 1, prompts.length - 1)
        : Math.max(index - 1, 0);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = prompts[nextIndex];
      if (next) {
        rows.current.get(next.id)?.focus();
      }
    }
    if (
      event.key === "Enter" &&
      !id &&
      search.selectedId &&
      prompts.some((prompt) => prompt.id === search.selectedId)
    ) {
      event.preventDefault();
      void copy(search.selectedId);
    }
  };
  const collectionNames = new Map(
    search.page?.collections.map((entry) => [entry.id, entry.name])
  );
  const selectedVisible = search.page?.prompts.some(
    (prompt) => prompt.id === search.selectedId
  );
  return (
    <section aria-label="Find and copy" className="wf-launcher">
      <PromptVariables copy={copying} />
      <div className="wf-launcher-search">
        <Search aria-hidden="true" size={18} />
        <input
          ref={input}
          aria-label="Search prompts"
          type="search"
          placeholder="Find a prompt and copy it with ↵…"
          value={search.query}
          onChange={(event) => search.changeQuery(event.target.value)}
          onKeyDown={(event) => move(event)}
        />
        {search.query ? (
          <button
            className="wf-btn-quiet"
            type="button"
            onClick={() => search.changeQuery("")}
          >
            Clear query
          </button>
        ) : null}
        <kbd aria-hidden="true" className="wf-kbd">
          esc
        </kbd>
      </div>
      <LauncherFilters search={search} />
      <div className="wf-launcher-status">
        {copyMessage || search.error ? (
          <p className="wf-notice" role="alert">
            {copyMessage || search.error}
            {search.recoveryNeeded
              ? " Open the library to rebuild the search index."
              : ""}
          </p>
        ) : null}
      </div>
      <p className="sr-only">
        Arrow keys select; Enter copies. Tab reaches filters and pages.
      </p>
      <div
        aria-busy={search.busy}
        className="wf-launcher-list"
        data-search-query={search.busy ? undefined : search.query}
      >
        <ul aria-label="Launcher results">
          {search.page?.prompts.map((prompt) => (
            <li key={prompt.id}>
              <button
                ref={(element) => {
                  if (element) {
                    rows.current.set(prompt.id, element);
                  } else {
                    rows.current.delete(prompt.id);
                  }
                }}
                type="button"
                className="wf-launcher-row"
                aria-pressed={search.selectedId === prompt.id}
                disabled={search.busy || busy}
                onFocus={() => {
                  void search.select(prompt.id);
                }}
                onKeyDown={(event) => move(event, prompt.id)}
                onClick={() => {
                  void search.select(prompt.id);
                  void copy(prompt.id);
                }}
              >
                <span
                  className="wf-dot"
                  data-accent={accentFor(prompt.collectionId)}
                />
                <strong>{prompt.title}</strong>
                <span className="wf-mono" aria-hidden="true">
                  {prompt.collectionId
                    ? collectionNames.get(prompt.collectionId)
                    : ""}
                </span>
                <kbd>
                  <span className="sr-only">Copy </span>↵
                </kbd>
              </button>
            </li>
          ))}
        </ul>
        <EmptyResults search={search} />
      </div>
      <div className="wf-launcher-foot">
        <span>↑↓ Navigate</span>
        <span>↵ Copy</span>
        <span className="wf-grow" />
        <nav aria-label="Launcher result pages" className="flex gap-2">
          <button
            className="wf-btn-quiet"
            type="button"
            disabled={search.busy || busy || !search.offset}
            onClick={() => search.previous()}
          >
            Previous
          </button>
          <button
            className="wf-btn-quiet"
            type="button"
            disabled={search.busy || busy || !search.page?.nextCursor}
            onClick={() => search.next()}
          >
            Next
          </button>
        </nav>
        <button
          className="wf-btn-quiet"
          type="button"
          disabled={search.busy || busy || !selectedVisible}
          onClick={() => {
            if (search.selectedId) {
              void copy(search.selectedId);
            }
          }}
        >
          Copy selected prompt
        </button>
      </div>
    </section>
  );
};

const LauncherNotices = ({
  status,
  alert,
  onFocus,
}: {
  status?: LauncherStatus;
  alert: string;
  onFocus: () => void;
}) => (
  <div className="wf-launcher-status">
    {status?.visible && !status.focused ? (
      <div className="wf-notice" data-tone="attention">
        <button type="button" className="wf-btn" onClick={onFocus}>
          Click to search
        </button>
        <p className="mt-2">
          Use Alt+Tab to select Quick launcher, or open it from the library.
        </p>
      </div>
    ) : null}
    {status?.visible && status.account && !status.complete ? (
      <output className="wf-notice">
        Library download incomplete. Searching downloaded prompts only.
      </output>
    ) : null}
    {status && !status.error && !status.account ? (
      <p className="wf-notice">
        Open the library to sign in and download prompts.
      </p>
    ) : null}
    {alert ? (
      <p className="wf-notice" role="alert">
        {alert}
      </p>
    ) : null}
  </div>
);

const LauncherWindow = () => {
  const { status, revision, error, refresh } = useLauncherStatus();
  const [message, setMessage] = useState("");
  const opening = status?.opening;
  const showDetails = async () => {
    try {
      await launcherClient.libraryDetails();
    } catch {
      setMessage(
        "Could not open library details. Use Alt+Tab to open the library."
      );
    }
  };
  const close = async () => {
    if (opening === undefined) {
      return;
    }
    try {
      await launcherClient.hide(opening);
    } catch {
      setMessage("Could not close the launcher. Try again.");
    }
  };
  const focus = async () => {
    try {
      await launcherClient.focus();
    } catch {
      setMessage(
        "Use Alt+Tab to select Quick launcher, or open it from the library."
      );
    }
  };
  const escape = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (
      event.key === "Escape" &&
      opening !== undefined &&
      !event.defaultPrevented
    ) {
      void close();
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  return (
    <WayfinderShell surface="launcher">
      <main className="wf-launcher" data-opening={status?.opening}>
        <h1 className="sr-only">Quick launcher</h1>
        <LauncherNotices
          status={status}
          alert={error || message}
          onFocus={() => {
            void focus();
          }}
        />
        {status?.visible && status.account ? (
          <LauncherSearch
            key={`${status.opening}:${status.account.instanceId}:${status.account.accountId}:${status.account.generation}`}
            status={status}
            account={status.account}
            revision={revision}
          />
        ) : (
          <span className="wf-grow" />
        )}
        <footer className="wf-launcher-foot">
          <span
            className="wf-shortcut"
            data-state={status?.shortcut ? undefined : "unavailable"}
          >
            {status?.shortcut ?? "Global shortcut unavailable"}
          </span>
          <span>{status?.syncStatus ?? "Library status"}</span>
          <button
            className="wf-link"
            type="button"
            onClick={() => {
              void showDetails();
            }}
          >
            Open library details
          </button>
          <span className="wf-grow" />
          <ThemeToggle size="sm" />
          <button
            className="wf-btn-quiet"
            type="button"
            onClick={() => {
              void refresh();
            }}
          >
            Refresh status
          </button>
          <button
            className="wf-btn-quiet"
            type="button"
            onClick={() => {
              if (opening !== undefined) {
                void close();
              }
            }}
          >
            Close (Esc)
          </button>
        </footer>
      </main>
    </WayfinderShell>
  );
};

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing launcher root element");
}
createRoot(root).render(
  <StrictMode>
    <LauncherWindow />
  </StrictMode>
);
