import type { LocalOrganization } from "@pr0/api-contract/local-organization";
import { organizationSearch } from "@pr0/api-contract/organization";
import { promptSortSchema } from "@pr0/api-contract/prompts";
import type { Collection, PromptView } from "@pr0/api-contract/prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { pickerSearchThreshold } from "@pr0/ui/components/picker-search";
import { PromptIconAction } from "@pr0/ui/components/prompt-actions";
import { PromptRow } from "@pr0/ui/components/prompt-row";
import { SearchBox } from "@pr0/ui/components/search-box";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { localizedLabel, translate } from "@pr0/ui/lib/i18n";
import { accentFor } from "@pr0/ui/lib/present";
import { Inbox, Star } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { OrganizationControls } from "./organization-controls";
import type { Status } from "./use-auth-session";
import { useLocalSearch } from "./use-local-search";

// `short` is the visible label; each is contained in its accessible name.
const views: { value: PromptView; label: string; short: string }[] = [
  {
    value: "all",
    label: translate("allDownloadedPrompts"),
    short: translate("all"),
  },
  {
    value: "favorites",
    label: translate("favorites"),
    short: translate("favorites"),
  },
  {
    value: "recents",
    label: translate("recents"),
    short: translate("recents"),
  },
  {
    value: "archive",
    label: translate("archive"),
    short: translate("archive"),
  },
];
const sorts = [
  { value: "recently-used", label: translate("recentlyUsed") },
  { value: "recently-modified", label: translate("recentlyModified") },
  { value: "newest", label: translate("newest") },
  { value: "oldest", label: translate("oldest") },
  { value: "title", label: translate("titleAZ") },
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
  const t = useTranslations();

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
  const searchable = entries.length > pickerSearchThreshold;
  return (
    <div className="flex flex-col gap-2">
      <div className="wf-section-head">
        <h3 className="wf-eyebrow">
          {label}
          {selected.length ? t("valueSelected", [selected.length]) : ""}
        </h3>
      </div>
      {searchable ? (
        <label className="wf-hint">
          {t("find")} {localizedLabel(label)}
          <input
            className="mt-1 w-full text-sm"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}
      <fieldset className="wf-chips max-h-40 overflow-y-auto">
        <legend className="sr-only">{label}</legend>
        {multiple ? null : (
          <label className="wf-chip">
            <input
              type="radio"
              name={label}
              checked={selected.length === 0}
              onChange={() => onChange([])}
            />
            <span className="wf-dot" />
            {t("any")}
          </label>
        )}
        {selected.map((id) =>
          available.has(id) ? null : (
            <label key={id} className="wf-chip">
              <input
                type="checkbox"
                checked
                onChange={() =>
                  onChange(selected.filter((value) => value !== id))
                }
              />
              {t("unavailable")} {localizedLabel(label)}: {id} {t("remove2")}
            </label>
          )
        )}
        {entries.map((entry) => {
          // oxlint-disable-next-line react-doctor/js-set-map-lookups -- Names use literal substring matching, not array membership.
          if (!chosen.has(entry.id) && !nameMatches(entry.name, normalized)) {
            return null;
          }
          return (
            <label key={entry.id} className="wf-chip">
              <input
                type={multiple ? "checkbox" : "radio"}
                name={label}
                checked={chosen.has(entry.id)}
                onChange={() => toggle(entry.id)}
              />
              <span className="wf-dot" data-accent={accentFor(entry.id)} />
              {entry.name}
              <span className="sr-only">
                {" "}
                ({entry.totalCount}; {entry.activeCount} {t("active")}{" "}
                {entry.archivedCount} {t("archived")}
              </span>
              <small aria-hidden="true">{entry.totalCount}</small>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
};

const emptyMessage = (view: PromptView) => {
  if (view === "recents") {
    return translate("copiedActivePromptsAppearInRecentsUsesAreOrderedBy");
  }
  if (view === "collection") {
    return translate("thisCollectionIsEmpty");
  }
  if (view === "favorites") {
    return translate("noFavoritesYet");
  }
  if (view === "archive") {
    return translate("noArchivedPrompts");
  }
  return translate("yourDownloadedLibraryIsEmptyChooseNewPromptToCreate");
};

const SearchResults = ({
  attentionIds,
  search,
  copying,
  onCopy,
  onFavorite,
  changing,
  headActions,
}: {
  attentionIds?: ReadonlySet<string>;
  search: ReturnType<typeof useLocalSearch>;
  copying: boolean;
  changing: boolean;
  onFavorite: (id: string) => Promise<void>;
  onCopy: (id: string) => Promise<void>;
  headActions: ReactNode;
}) => {
  const t = useTranslations();

  const { page } = search;
  const collectionNames = new Map(
    page?.collections.map((entry) => [entry.id, entry.name])
  );
  const tagNames = new Map(page?.tags.map((entry) => [entry.id, entry.name]));
  return (
    <section aria-labelledby="downloaded-results" className="wf-results">
      <div className="wf-list-head">
        <h3 className="wf-eyebrow" id="downloaded-results">
          {t("downloadedPrompts")}
        </h3>
        {page?.prompts.length ? (
          <span className="wf-eyebrow" aria-hidden="true">
            {search.offset + 1}–{search.offset + page.prompts.length}
          </span>
        ) : null}
        <span className="wf-grow" />
        {headActions}
      </div>
      <div
        aria-busy={search.busy}
        className="wf-list"
        data-search-query={search.busy ? undefined : search.query}
      >
        <ul aria-label={t("searchResults")}>
          {page?.prompts.map((row) => (
            <PromptRow
              key={row.id}
              label={row.title}
              title={row.title}
              suffix={`${row.archived ? " (Archived)" : ""}${
                attentionIds?.has(row.id) ? t("changesNeedAttention2") : ""
              }`}
              preview={row.description}
              collection={
                row.collectionId
                  ? collectionNames.get(row.collectionId)
                  : undefined
              }
              accent={accentFor(row.collectionId)}
              tags={row.tagIds.flatMap((id) => tagNames.get(id) ?? [])}
              modifiedAt={row.modifiedAt}
              selected={search.selectedId === row.id}
              disabled={search.busy}
              onSelect={() => {
                void search.select(row.id);
              }}
            >
              <PromptIconAction
                kind="copy"
                size="sm"
                disabled={search.busy || copying}
                label={t("copyValue", [row.title])}
                onClick={() => {
                  void onCopy(row.id);
                }}
              />
              <PromptIconAction
                kind="favorite"
                size="sm"
                active={row.favorite}
                disabled={search.busy || changing}
                label={`${row.favorite ? t("unfavorite") : t("favorite")} ${row.title}`}
                onClick={() => {
                  void onFavorite(row.id);
                }}
              />
            </PromptRow>
          ))}
        </ul>
        {!search.busy && !search.error && page?.prompts.length === 0 ? (
          <output className="wf-empty">
            <Inbox aria-hidden="true" size={28} />
            {search.restricted
              ? t("noMatchingPrompts")
              : emptyMessage(search.view)}
          </output>
        ) : null}
        <nav
          aria-label={t("downloadedPromptPages")}
          className="flex justify-center gap-2 pt-2"
        >
          <button
            className="wf-btn-quiet"
            type="button"
            disabled={search.busy || search.offset === 0}
            onClick={() => search.previous()}
          >
            {t("previous")}
          </button>
          <button
            className="wf-btn-quiet"
            type="button"
            disabled={search.busy || !page?.nextCursor}
            onClick={() => search.next()}
          >
            {t("next")}
          </button>
        </nav>
      </div>
    </section>
  );
};
export const SearchLibrary = ({
  attentionIds,
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
  headActions,
}: {
  /** Controls beside the result count, such as the New prompt button. */
  headActions: ReactNode;
  attentionIds?: ReadonlySet<string>;
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
  const t = useTranslations();

  const search = useLocalSearch(account, refresh, onSelect);
  const { page } = search;
  return (
    <section aria-label={t("offlineSearch")} className="contents">
      <div className="wf-sidebar-top">
        <SearchBox
          aria-label={t("searchDownloadedPrompts")}
          data-library-search
          hint="/"
          placeholder={t("searchDownloadedPrompts2")}
          value={search.query}
          onChange={(event) => search.changeQuery(event.target.value)}
        />
        <nav aria-label={t("libraryViews")} className="wf-segment">
          {views.map((view) => (
            <button
              key={view.value}
              type="button"
              aria-label={view.label}
              aria-pressed={search.view === view.value}
              onClick={() => search.navigate(view.value)}
            >
              {view.short}
            </button>
          ))}
        </nav>
        <div className="wf-filter-row">
          <label className="wf-chip">
            <input
              type="checkbox"
              checked={search.favorite}
              onChange={(event) => search.changeFavorite(event.target.checked)}
            />
            <Star
              aria-hidden="true"
              size={12}
              fill={search.favorite ? "currentColor" : "none"}
            />
            {t("favoritesOnly")}
          </label>
          {search.query ? (
            <button
              className="wf-btn-quiet"
              type="button"
              onClick={() => search.changeQuery("")}
            >
              {t("clearQuery")}
            </button>
          ) : null}
          <span className="wf-grow" />
          <select
            aria-label={t("sortPrompts")}
            value={search.sort}
            onChange={(event) =>
              search.changeSort(promptSortSchema.parse(event.target.value))
            }
          >
            {search.searching ? (
              <option value="relevance">{t("relevance")}</option>
            ) : null}
            {sorts.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </select>
        </div>
        {search.collectionId || search.tagIds.length || search.favorite ? (
          <button
            className="wf-btn-quiet self-start"
            type="button"
            onClick={() => search.clearFilters()}
          >
            {t("clearAdditionalFilters")}
          </button>
        ) : null}
        {search.error ? (
          <div className="wf-notice" role="alert">
            <LocalizedMessage value={search.error} />
            {search.recoveryNeeded ? (
              <button
                className="wf-btn mt-2"
                type="button"
                disabled={search.busy}
                onClick={() => {
                  void search.recover();
                }}
              >
                {t("rebuildSearchIndex")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="wf-section">
        <OrganizationPicker
          label={t("collectionView")}
          entries={page?.collections ?? []}
          selected={search.viewCollectionId ? [search.viewCollectionId] : []}
          onChange={(ids) =>
            ids[0]
              ? search.navigate("collection", ids[0])
              : search.navigate("all")
          }
        />
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
      </div>
      <SearchResults
        attentionIds={attentionIds}
        search={search}
        copying={copying}
        onCopy={onCopy}
        onFavorite={onFavorite}
        changing={changing}
        headActions={headActions}
      />
    </section>
  );
};
