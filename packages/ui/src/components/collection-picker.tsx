"use client";

import { useId, useState } from "react";

import { PickerSearch } from "./picker-search";

const buttonClass =
  "rounded-md border px-3 py-2 text-left break-words focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
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
    <fieldset
      disabled={disabled}
      className="wf-picker min-w-0 space-y-2 rounded-md border p-3"
    >
      <legend className={compact ? "sr-only" : "px-1 font-medium"}>
        {label}
      </legend>
      <p hidden={compact} className="text-muted-foreground text-sm">
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
      <PickerSearch compact={compact} label={label}>
        <label className="block" htmlFor={id}>
          Search {label.toLowerCase()}
        </label>
        <input
          id={id}
          className="bg-background w-full rounded-md border p-2 focus-visible:outline-2"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </PickerSearch>{" "}
      <fieldset
        className="max-h-48 space-y-1 overflow-y-auto p-1"
        aria-label={`${label} options`}
      >
        <button
          type="button"
          className={`${buttonClass} block w-full`}
          aria-pressed={!value}
          onClick={() => onChange(null)}
        >
          {emptyLabel}
        </button>
        {visible.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`${buttonClass} block w-full`}
            aria-pressed={value === entry.id}
            onClick={() => onChange(entry.id)}
          >
            {entry.name} · {entry.totalCount} total, {entry.activeCount} active,{" "}
            {entry.archivedCount} archived
          </button>
        ))}
      </fieldset>
    </fieldset>
  );
};
