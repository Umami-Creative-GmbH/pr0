"use client";

import { useId, useState } from "react";

import { accentFor } from "../lib/present";
import { PickerSearch } from "./picker-search";

const buttonClass = "wf-btn";
const countsLabel = (entry: CollectionOption) =>
  `${entry.name} · ${entry.totalCount} total, ${entry.activeCount} active, ${entry.archivedCount} archived`;
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
  const id = useId();
  const [query, setQuery] = useState("");
  const visible = collections.filter((entry) => search(entry.name, query));
  const selected = collections.find((entry) => entry.id === value);
  const selectedName =
    selected?.name ?? unavailableName ?? "Unavailable collection";
  return (
    <fieldset disabled={disabled} className="wf-field">
      <legend className={compact ? "sr-only" : "wf-label mb-2"}>{label}</legend>
      <p hidden={compact} className="wf-hint">
        Counts are library-wide, including the archive, for the available
        snapshot.
      </p>
      {value ? (
        <div className="max-h-24 overflow-y-auto">
          <button
            className={buttonClass}
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Remove collection ${selectedName}`}
          >
            {selectedName} · Remove
          </button>
        </div>
      ) : null}
      <PickerSearch compact={compact} label={label} count={collections.length}>
        <label className="wf-hint mt-2 block" htmlFor={id}>
          Search {label.toLowerCase()}
        </label>
        <input
          id={id}
          className="mt-1 w-full text-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </PickerSearch>{" "}
      <fieldset
        className={compact ? "wf-chips" : "wf-chips max-h-48 overflow-y-auto"}
        aria-label={`${label} options`}
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
