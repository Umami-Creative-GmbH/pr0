/**
 * PROTOTYPE (issue #9) — the launcher's compact filter row.
 *
 * Issue #7: "It supports compact optional collection, tag, and favorite
 * filters with the same AND rules." These reset on every opening along with
 * the query, because the panel is remounted each time.
 */

import { useTranslate } from "@tolgee/react";
import { Star } from "lucide-react";

import type { Collection, CollectionId, Tag, TagId } from "../domain/types";

export interface LauncherFiltersProps {
  collections: Collection[];
  /** Only tags actually in play, so the row stays compact. */
  tags: Tag[];
  collectionId: CollectionId | null;
  activeTags: Set<TagId>;
  favoriteOnly: boolean;
  onToggleCollection: (collectionId: CollectionId) => void;
  onToggleTag: (tagId: TagId) => void;
  onToggleFavorite: () => void;
}

export const LauncherFilters = ({
  collections,
  tags,
  collectionId,
  activeTags,
  favoriteOnly,
  onToggleCollection,
  onToggleTag,
  onToggleFavorite,
}: LauncherFiltersProps) => {
  const { t } = useTranslate();

  return (
    <div className="pr0-launcher-filters">
      <button
        aria-pressed={favoriteOnly}
        className="pr0-chip"
        onClick={onToggleFavorite}
        type="button"
      >
        <Star aria-hidden="true" size={12} />
        {t("filters.favoriteOnly")}
      </button>

      {collections.map((collection) => (
        <button
          aria-pressed={collectionId === collection.id}
          className="pr0-chip"
          key={collection.id}
          onClick={() => onToggleCollection(collection.id)}
          type="button"
        >
          <span className="pr0-dot" style={{ background: collection.accent }} />
          {collection.name}
        </button>
      ))}

      {tags.map((tag) => (
        <button
          aria-pressed={activeTags.has(tag.id)}
          className="pr0-chip"
          key={tag.id}
          onClick={() => onToggleTag(tag.id)}
          type="button"
        >
          {`#${tag.name}`}
        </button>
      ))}
    </div>
  );
};
