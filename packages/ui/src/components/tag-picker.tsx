"use client";

import { useId, useState } from "react";

import type { CollectionOption } from "./collection-picker";

export const TagPicker = ({
  tags,
  value,
  onChange,
  search,
  label,
  disabled = false,
  unavailableNames,
}: {
  tags: CollectionOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  search: (name: string, query: string) => boolean;
  label: string;
  disabled?: boolean;
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
    <fieldset
      disabled={disabled}
      className="wf-picker min-w-0 space-y-2 rounded-md border p-3"
    >
      <legend className="px-1 font-medium">{label}</legend>
      <p className="text-muted-foreground text-sm">
        Counts are library-wide, including the archive, for the available
        snapshot.
      </p>
      <div className="max-h-24 space-x-2 overflow-y-auto">
        {value.map((tagId) => (
          <button
            key={tagId}
            type="button"
            className="rounded-md border px-2 py-1 break-words focus-visible:outline-2"
            onClick={() => onChange(value.filter((entry) => entry !== tagId))}
            aria-label={`Remove tag ${nameFor(tagId)}`}
          >
            {nameFor(tagId)} · Remove
          </button>
        ))}
      </div>
      <label className="block" htmlFor={id}>
        Search {label.toLowerCase()}
      </label>
      <input
        id={id}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="bg-background w-full rounded-md border p-2 focus-visible:outline-2"
      />
      <div className="max-h-48 space-y-2 overflow-y-auto p-1">
        {visible.map((tag) => (
          <label
            key={tag.id}
            className="flex items-start gap-2 rounded-md border p-2 break-words"
          >
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
              className="mt-1 focus-visible:outline-2"
            />
            <span>
              {tag.name} · {tag.totalCount} total, {tag.activeCount} active,{" "}
              {tag.archivedCount} archived
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};
