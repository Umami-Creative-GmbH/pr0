"use client";
import { useState } from "react";

import type { CollectionOption } from "./collection-picker";

const buttonClass = "wf-btn";
export const CollectionList = ({
  collections,
  search,
  disabled,
  onRename,
  onDelete,
  label = "Collections",
}: {
  label?: "Collections" | "Tags";
  collections: CollectionOption[];
  search: (name: string, query: string) => boolean;
  disabled: boolean;
  onRename: (entry: CollectionOption) => void;
  onDelete?: (entry: CollectionOption) => void;
}) => {
  const [query, setQuery] = useState("");
  const [unused, setUnused] = useState(false);
  const visible = collections.filter(
    (entry) => (!unused || entry.totalCount === 0) && search(entry.name, query)
  );
  return (
    <>
      <label className="block" htmlFor="collection-search">
        Search {label.toLowerCase()}
      </label>
      <input
        id="collection-search"
        className="bg-background w-full rounded-md border p-2 focus-visible:outline-2"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={unused}
          onChange={(event) => setUnused(event.target.checked)}
        />
        Unused
      </label>
      <ul aria-label={label} className="max-h-72 space-y-2 overflow-y-auto p-1">
        {visible.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
          >
            <div className="min-w-0 break-words">
              <span className="font-medium">{entry.name}</span>
              <p>
                {entry.totalCount} total · {entry.activeCount} active ·{" "}
                {entry.archivedCount} archived
              </p>
            </div>
            <button
              className={buttonClass}
              aria-label={`Rename ${entry.name}`}
              disabled={disabled}
              type="button"
              onClick={() => onRename(entry)}
            >
              Rename
            </button>
            {onDelete ? (
              <button
                type="button"
                className={buttonClass}
                aria-label={`Delete ${entry.name}`}
                disabled={disabled}
                onClick={() => onDelete(entry)}
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {visible.length ? null : <p>No matching {label.toLowerCase()}.</p>}
    </>
  );
};
