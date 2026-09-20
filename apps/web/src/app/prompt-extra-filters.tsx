"use client";

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
  <div className="flex flex-wrap items-center gap-3">
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={favorite}
        onChange={(event) => onFavorite(event.target.checked)}
      />
      Favorites only
    </label>
    {hasExtraFilters ? (
      <button
        type="button"
        className="rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={onClear}
      >
        Clear extra filters
      </button>
    ) : null}
  </div>
);
