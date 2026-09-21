"use client";

import { useId, useState } from "react";

import type { CollectionOption } from "./collection-picker";
import { PickerSearch } from "./picker-search";

export const TagPicker = ({
  tags,
  value,
  onChange,
  search,
  label,
  disabled = false,
  compact = false,
  unavailableNames,
}: {
  tags: CollectionOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  search: (name: string, query: string) => boolean;
  label: string;
  disabled?: boolean;
  compact?: boolean;
  unavailableNames?: ReadonlyMap<string, string>;
}) => {
  const id = useId();
  const [query, setQuery] = useState("");
  const selected = new Set(value);
  const visible = tags.filter((tag) => search(tag.name, query));
  const names = new Map(tags.map((tag) => [tag.id, tag.name]));
  const nameFor = (tagId: string) =>
    names.get(tagId) ?? unavailableNames?.get(tagId) ?? "Unavailable tag";
  return (
    <fieldset disabled={disabled} className="wf-field">
      <legend className={compact ? "sr-only" : "wf-label mb-2"}>{label}</legend>
      <p hidden={compact || !tags.length} className="wf-hint">
        Counts are library-wide, including the archive, for the available
        snapshot.
      </p>
      <div className="wf-chips max-h-24 overflow-y-auto empty:hidden">
        {value.map((tagId) => (
          <button
            key={tagId}
            type="button"
            className="wf-chip"
            data-kind="tag"
            aria-pressed="true"
            onClick={() => onChange(value.filter((entry) => entry !== tagId))}
            aria-label={`Remove tag ${nameFor(tagId)}`}
          >
            {nameFor(tagId)} · Remove
          </button>
        ))}
      </div>
      <PickerSearch count={tags.length}>
        <label
          className={compact ? "sr-only" : "wf-hint mt-2 block"}
          htmlFor={id}
        >
          Search {label.toLowerCase()}
        </label>
        <input
          id={id}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-1 w-full text-sm"
          placeholder={compact ? `Search ${label.toLowerCase()}` : undefined}
        />
      </PickerSearch>{" "}
      <div
        className={compact ? "wf-chips" : "wf-chips max-h-48 overflow-y-auto"}
      >
        {visible.map((tag) => (
          <label key={tag.id} className="wf-chip" data-kind="tag">
            <input
              type="checkbox"
              checked={selected.has(tag.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, tag.id]
                    : value.filter((entry) => entry !== tag.id)
                )
              }
            />
            <span>
              <span aria-hidden="true">#</span>
              {tag.name}
              <span className="sr-only">
                {" "}
                · {tag.totalCount} total, {tag.activeCount} active,{" "}
                {tag.archivedCount} archived
              </span>
            </span>
            <small aria-hidden="true">{tag.totalCount}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
};
