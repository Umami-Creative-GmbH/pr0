"use client";

import { Star } from "lucide-react";

export const PromptExtraFilters = ({
  favorite,
  hasExtraFilters,
  onFavorite,
  onClear,
}: {
  favorite: boolean;
  hasExtraFilters: boolean;
  onFavorite: (value: boolean) => void;
  onClear: () => void;
}) => (
  <>
    <label className="wf-chip">
      <input
        type="checkbox"
        checked={favorite}
        onChange={(event) => onFavorite(event.target.checked)}
      />
      <Star
        aria-hidden="true"
        size={12}
        fill={favorite ? "currentColor" : "none"}
      />
      Favorites only
    </label>
    {hasExtraFilters ? (
      <button type="button" className="wf-btn-quiet" onClick={onClear}>
        Clear extra filters
      </button>
    ) : null}
  </>
);
