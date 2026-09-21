import type { LocalOrganization } from "@pr0/api-contract/local-organization";
import { organizationSearch } from "@pr0/api-contract/organization";
import { promptSortSchema } from "@pr0/api-contract/prompts";
import type { Collection, PromptView } from "@pr0/api-contract/prompts";
import { PromptIconAction } from "@pr0/ui/components/prompt-actions";
import { useState } from "react";

import { OrganizationControls } from "./organization-controls";
import type { Status } from "./use-auth-session";
import { useLocalSearch } from "./use-local-search";

const views: { value: PromptView; label: string }[] = [
  { value: "all", label: "All downloaded prompts" },
  { value: "favorites", label: "Favorites" },
  { value: "recents", label: "Recents" },
  { value: "archive", label: "Archive" },
];
const sorts = [
  { value: "recently-used", label: "Recently used" },
  { value: "recently-modified", label: "Recently modified" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "Title A–Z" },
];
const nameMatches = (name: string, query: string) =>
  organizationSearch(name).includes(query);
const OrganizationPicker = ({
  label,
  entries,
  selected,
  onChange,
  multiple = false,
}: {
  label: string;
  entries: Collection[];
  selected: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
}) => {
  const [query, setQuery] = useState("");
  const normalized = organizationSearch(query);
  const available = new Set(entries.map((entry) => entry.id));
  const chosen = new Set(selected);
  const toggle = (id: string) => {
    if (!multiple) {
      onChange([id]);
      return;
    }
    onChange(
      chosen.has(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id]
    );
  };
  return (
    <details>
      <summary>
        {label}
        {selected.length ? ` (${selected.length} selected)` : ""}
      </summary>
      <label>
        Find {label.toLowerCase()}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <fieldset className="max-h-48 overflow-y-auto rounded border p-2">
        <legend>{label}</legend>
        {multiple ? null : (
          <label className="block">
            <input
              type="radio"
              name={label}
              checked={selected.length === 0}
              onChange={() => onChange([])}
            />{" "}
            Any
          </label>
        )}
        {selected.map((id) =>
          available.has(id) ? null : (
            <label key={id} className="block">
              <input
                type="checkbox"
                checked
                onChange={() =>
                  onChange(selected.filter((value) => value !== id))
                }
              />{" "}
              Unavailable {label.toLowerCase()}: {id} (remove)
            </label>
          )
        )}
        {entries.map((entry) => {
          // oxlint-disable-next-line react-doctor/js-set-map-lookups -- Names use literal substring matching, not array membership.
          if (!chosen.has(entry.id) && !nameMatches(entry.name, normalized)) {
            return null;
          }
          return (
            <label key={entry.id} className="block">
              <input
                type={multiple ? "checkbox" : "radio"}
                name={label}
                checked={chosen.has(entry.id)}
                onChange={() => toggle(entry.id)}
              />
              {entry.name} ({entry.totalCount}; {entry.activeCount} active,{" "}
              {entry.archivedCount} archived)
            </label>
          );
        })}
      </fieldset>
    </details>
  );
};

const emptyMessage = (view: PromptView) => {
  if (view === "recents") {
    return "Copied active prompts appear in Recents. Uses are ordered by when they happened.";
  }
  if (view === "collection") {
    return "This collection is empty.";
  }
  if (view === "favorites") {
    return "No favorites yet.";
  }
  if (view === "archive") {
    return "No archived prompts.";
  }
  return "Your downloaded library is empty. Choose New prompt to create one.";
};

const SearchResults = ({
  search,
  copying,
  onCopy,
  onFavorite,
  changing,
}: {
  search: ReturnType<typeof useLocalSearch>;
  copying: boolean;
  changing: boolean;
  onFavorite: (id: string) => Promise<void>;
  onCopy: (id: string) => Promise<void>;
}) => {
  const { page } = search;
  return (
    <>
      <div
        aria-busy={search.busy}
        data-search-query={search.busy ? undefined : search.query}
      >
        <ul aria-label="Search results" className="space-y-2">
          {page?.prompts.map((row) => (
            <li key={row.id} className="wf-row">
              <button
                data-prompt-row
                aria-label={row.title}
                type="button"
                className="rounded border px-3 py-2 text-left"
                aria-pressed={search.selectedId === row.id}
                disabled={search.busy}
                onClick={() => {
                  void search.select(row.id);
                }}
              >
                <span>
                  {row.title}
                  {row.archived ? " (Archived)" : ""}
                </span>
                {row.description ? (
                  <span className="text-muted-foreground block">
                    {row.description}
                  </span>
                ) : null}
              </button>
              <div className="wf-row-actions">
                <PromptIconAction
                  kind="favorite"
                  active={row.favorite}
                  disabled={search.busy || changing}
                  label={`${row.favorite ? "Unfavorite" : "Favorite"} ${row.title}`}
                  onClick={() => {
                    void onFavorite(row.id);
                  }}
                />
                <PromptIconAction
                  kind="copy"
                  disabled={search.busy || copying}
                  label={`Copy ${row.title}`}
                  onClick={() => {
                    void onCopy(row.id);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        {!search.busy && !search.error && page?.prompts.length === 0 ? (
          <output>
            {search.restricted
              ? "No matching prompts"
              : emptyMessage(search.view)}
          </output>
        ) : null}
      </div>
      <nav aria-label="Downloaded prompt pages" className="flex gap-4">
        <button
          type="button"
          disabled={search.busy || search.offset === 0}
          onClick={() => search.previous()}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={search.busy || !page?.nextCursor}
          onClick={() => search.next()}
        >
          Next
        </button>
      </nav>
    </>
  );
};
export const SearchLibrary = ({
  account,
  refresh,
  organization,
  onOrganizationSaved,
  editingDisabled,
  onEditing,
  onSelect,
  onCopy,
  copying,
  onFavorite,
  changing,
}: {
  account: Status;
  refresh: number;
  organization?: LocalOrganization;
  onOrganizationSaved: () => Promise<void>;
  editingDisabled: boolean;
  onEditing: (editing: boolean) => void;
  onSelect: (
    id: string | null,
    reason?: "refresh" | "navigation"
  ) => Promise<void>;
  onCopy: (id: string) => Promise<void>;
  copying: boolean;
  changing: boolean;
  onFavorite: (id: string) => Promise<void>;
}) => {
  const search = useLocalSearch(account, refresh, onSelect);
  const { page } = search;
  return (
    <section aria-label="Offline search" className="space-y-3">
      <nav aria-label="Library views" className="flex flex-wrap gap-4">
        {views.map((view) => (
          <button
            key={view.value}
            type="button"
            aria-pressed={search.view === view.value}
            onClick={() => search.navigate(view.value)}
          >
            {view.label}
          </button>
        ))}
      </nav>
      <OrganizationPicker
        label="Collection view"
        entries={page?.collections ?? []}
        selected={search.viewCollectionId ? [search.viewCollectionId] : []}
        onChange={(ids) =>
          ids[0]
            ? search.navigate("collection", ids[0])
            : search.navigate("all")
        }
      />
      <label className="block">
        Search downloaded prompts
        <input
          className="mt-1 block w-full rounded border p-2"
          type="search"
          value={search.query}
          onChange={(event) => search.changeQuery(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-4">
        {organization ? (
          <OrganizationControls
            account={account}
            snapshot={organization}
            filters={{
              collectionId: search.collectionId ?? null,
              tagIds: search.tagIds,
            }}
            onFilters={(filters) => search.changeFilters(filters)}
            onSaved={onOrganizationSaved}
            disabled={editingDisabled}
            onEditing={onEditing}
          />
        ) : null}
        <label>
          <input
            type="checkbox"
            checked={search.favorite}
            onChange={(event) => search.changeFavorite(event.target.checked)}
          />{" "}
          Favorites only
        </label>
        <label>
          Sort prompts
          <select
            value={search.sort}
            onChange={(event) =>
              search.changeSort(promptSortSchema.parse(event.target.value))
            }
          >
            {search.searching ? (
              <option value="relevance">Relevance</option>
            ) : null}
            {sorts.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {search.query ? (
        <button type="button" onClick={() => search.changeQuery("")}>
          Clear query
        </button>
      ) : null}
      {search.collectionId || search.tagIds.length || search.favorite ? (
        <button type="button" onClick={() => search.clearFilters()}>
          Clear additional filters
        </button>
      ) : null}
      {search.error ? (
        <div role="alert">
          {search.error}
          {search.recoveryNeeded ? (
            <button
              type="button"
              disabled={search.busy}
              onClick={() => {
                void search.recover();
              }}
            >
              Rebuild search index
            </button>
          ) : null}
        </div>
      ) : null}
      <SearchResults
        search={search}
        copying={copying}
        onCopy={onCopy}
        onFavorite={onFavorite}
        changing={changing}
      />
    </section>
  );
};
