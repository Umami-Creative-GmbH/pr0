"use client";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
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
}) => {
  const t = useTranslations();
  return (
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
        {t("favoritesOnly")}
      </label>
      {hasExtraFilters ? (
        <button type="button" className="wf-btn-quiet" onClick={onClear}>
          {t("clearExtraFilters")}
        </button>
      ) : null}
    </>
  );
};
