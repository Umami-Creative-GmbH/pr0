"use client";
import { useId, useState } from "react";

import { useTranslations } from "../hooks/use-translations";
import { localizedLabel, translate } from "../lib/i18n";
import { accentFor } from "../lib/present";
import { PickerSearch } from "./picker-search";

const buttonClass = "wf-btn";
const countsLabel = (entry: CollectionOption) =>
  translate("valueValueTotalValueActiveValueArchived", [
    entry.name,
    entry.totalCount,
    entry.activeCount,
    entry.archivedCount,
  ]);
export interface CollectionOption {
  id: string;
  name: string;
  activeCount: number;
  archivedCount: number;
  totalCount: number;
}
export const CollectionPicker = ({
  collections,
  value,
  onChange,
  search,
  label,
  emptyLabel,
  disabled = false,
  compact = false,
  unavailableName,
}: {
  collections: CollectionOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  search: (name: string, query: string) => boolean;
  label: string;
  emptyLabel: string;
  disabled?: boolean;
  compact?: boolean;
  unavailableName?: string;
}) => {
  const t = useTranslations();

  const id = useId();
  const [query, setQuery] = useState("");
  const visible = collections.filter((entry) => search(entry.name, query));
  const selected = collections.find((entry) => entry.id === value);
  const selectedName =
    selected?.name ?? unavailableName ?? t("unavailableCollection");
  return (
    <fieldset disabled={disabled} className="wf-field">
      <legend className={compact ? "sr-only" : "wf-label mb-2"}>{label}</legend>
      <p hidden={compact || !collections.length} className="wf-hint">
        {t("countsAreLibraryWideIncludingTheArchiveForTheAvailable")}
      </p>
      {value ? (
        <div className="max-h-24 overflow-y-auto">
          <button
            className={buttonClass}
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("removeCollectionValue", [selectedName])}
          >
            {selectedName} {t("remove3")}
          </button>
        </div>
      ) : null}
      <PickerSearch count={collections.length}>
        <label
          className={compact ? "sr-only" : "wf-hint mt-2 block"}
          htmlFor={id}
        >
          {t("search")} {localizedLabel(label)}
        </label>
        <input
          id={id}
          className="mt-1 w-full text-sm"
          placeholder={
            compact ? t("searchValue", [localizedLabel(label)]) : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </PickerSearch>
      <fieldset
        className={compact ? "wf-chips" : "wf-chips max-h-48 overflow-y-auto"}
        aria-label={t("valueOptions", [label])}
      >
        <button
          type="button"
          className="wf-chip"
          aria-pressed={!value}
          onClick={() => onChange(null)}
        >
          <span className="wf-dot" />
          {emptyLabel}
        </button>
        {visible.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="wf-chip"
            aria-label={countsLabel(entry)}
            aria-pressed={value === entry.id}
            onClick={() => onChange(entry.id)}
          >
            <span className="wf-dot" data-accent={accentFor(entry.id)} />
            {entry.name}
            <small>{entry.totalCount}</small>
          </button>
        ))}
      </fieldset>
    </fieldset>
  );
};
