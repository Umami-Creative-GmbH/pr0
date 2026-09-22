"use client";
import { useState } from "react";

import { useTranslations } from "../hooks/use-translations";
import { localizedLabel, translate } from "../lib/i18n";
import type { CollectionOption } from "./collection-picker";

const buttonClass = "wf-btn";
export const CollectionList = ({
  collections,
  search,
  disabled,
  onRename,
  onDelete,
  label = translate("collections"),
}: {
  label?: string;
  collections: CollectionOption[];
  search: (name: string, query: string) => boolean;
  disabled: boolean;
  onRename: (entry: CollectionOption) => void;
  onDelete?: (entry: CollectionOption) => void;
}) => {
  const t = useTranslations();

  const [query, setQuery] = useState("");
  const [unused, setUnused] = useState(false);
  const visible = collections.filter(
    (entry) => (!unused || entry.totalCount === 0) && search(entry.name, query)
  );
  return (
    <>
      <label className="block" htmlFor="collection-search">
        {t("search")} {localizedLabel(label)}
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
        {t("unused")}
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
                {entry.totalCount} {t("total")} {entry.activeCount}{" "}
                {t("active2")} {entry.archivedCount} {t("archived2")}
              </p>
            </div>
            <button
              className={buttonClass}
              aria-label={t("renameValue", [entry.name])}
              disabled={disabled}
              type="button"
              onClick={() => onRename(entry)}
            >
              {t("rename")}
            </button>
            {onDelete ? (
              <button
                type="button"
                className={buttonClass}
                aria-label={t("deleteValue2", [entry.name])}
                disabled={disabled}
                onClick={() => onDelete(entry)}
              >
                {t("delete")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {visible.length ? null : (
        <p>
          {t("noMatching")} {localizedLabel(label)}.
        </p>
      )}
    </>
  );
};
