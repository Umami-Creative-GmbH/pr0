import type { LauncherStatus } from "@pr0/api-contract/desktop-launcher";
import { organizationSearch } from "@pr0/api-contract/organization";
import { CollectionPicker } from "@pr0/ui/components/collection-picker";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import { WayfinderShell } from "@pr0/ui/components/wayfinder-shell";
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
  <details>
    <summary>
      Filters
      {search.collectionId || search.tagIds.length || search.favorite
        ? " (active)"
        : ""}
    </summary>
    <div className="space-y-2 py-2">
      <CollectionPicker
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
      <label className="block">
        <input
          type="checkbox"
          checked={search.favorite}
          onChange={(event) => search.changeFavorite(event.target.checked)}
        />{" "}
        Favorites only
      </label>
      <button type="button" onClick={() => search.clearFilters()}>
        Clear filters
      </button>
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
    <output>
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
  return (
    <section aria-label="Find and copy" className="space-y-3">
      <PromptVariables copy={copying} />
      <label className="block">
        Search prompts
        <input
          ref={input}
          type="search"
          className="mt-1 block w-full rounded border p-2"
          value={search.query}
          onChange={(event) => search.changeQuery(event.target.value)}
          onKeyDown={(event) => move(event)}
        />
      </label>
      {copyMessage || search.error ? (
        <p role="alert">
          {copyMessage || search.error}
          {search.recoveryNeeded
            ? " Open the library to rebuild the search index."
            : ""}
        </p>
      ) : null}
      <LauncherFilters search={search} />
      {search.query ? (
        <button type="button" onClick={() => search.changeQuery("")}>
          Clear query
        </button>
      ) : null}
      <p className="text-sm">
        Arrow keys select; Enter copies. Tab reaches filters and pages.
      </p>
      <div
        aria-busy={search.busy}
        data-search-query={search.busy ? undefined : search.query}
      >
        <ul
          aria-label="Launcher results"
          className="max-h-64 space-y-2 overflow-y-auto"
        >
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
                className="aria-pressed:bg-accent aria-pressed:text-accent-foreground w-full rounded border p-3 text-left focus-visible:outline-2"
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
                {prompt.title}
                <span className="ml-2 text-sm">Copy</span>
              </button>
            </li>
          ))}
        </ul>
        <EmptyResults search={search} />
      </div>
      <nav aria-label="Launcher result pages" className="flex gap-4">
        <button
          type="button"
          disabled={search.busy || busy || !search.offset}
          onClick={() => search.previous()}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={search.busy || busy || !search.page?.nextCursor}
          onClick={() => search.next()}
        >
          Next
        </button>
      </nav>
      <button
        type="button"
        disabled={
          search.busy ||
          busy ||
          !search.page?.prompts.some(
            (prompt) => prompt.id === search.selectedId
          )
        }
        onClick={() => {
          if (search.selectedId) {
            void copy(search.selectedId);
          }
        }}
      >
        Copy selected prompt
      </button>
    </section>
  );
};

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
      <main className="wf-launcher space-y-3" data-opening={status?.opening}>
        <h1 className="text-xl font-semibold">Quick launcher</h1>
        <p>{status?.shortcut ?? "Global shortcut unavailable"}</p>
        <p>
          {status?.syncStatus ?? "Library status"}{" "}
          <button
            type="button"
            onClick={() => {
              void showDetails();
            }}
          >
            Open library details
          </button>
        </p>
        {status?.visible && !status.focused ? (
          <div>
            <button
              type="button"
              className="rounded border p-2"
              onClick={() => {
                void focus();
              }}
            >
              Click to search
            </button>
            <p>
              Use Alt+Tab to select Quick launcher, or open it from the library.
            </p>
          </div>
        ) : null}
        {status?.visible && status.account ? (
          <>
            {status.complete ? null : (
              <output>
                Library download incomplete. Searching downloaded prompts only.
              </output>
            )}
            <LauncherSearch
              key={`${status.opening}:${status.account.instanceId}:${status.account.accountId}:${status.account.generation}`}
              status={status}
              account={status.account}
              revision={revision}
            />
          </>
        ) : null}
        {status && !status.error && !status.account ? (
          <p>Open the library to sign in and download prompts.</p>
        ) : null}
        {error || message ? <p role="alert">{error || message}</p> : null}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
          >
            Refresh status
          </button>
          <button
            type="button"
            onClick={() => {
              if (opening !== undefined) {
                void close();
              }
            }}
          >
            Close (Esc)
          </button>
        </div>
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
