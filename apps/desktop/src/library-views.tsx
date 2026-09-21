import type { LocalView } from "@pr0/api-contract/local-prompts";

const views: { value: LocalView; label: string }[] = [
  { value: "all", label: "All downloaded prompts" },
  { value: "favorites", label: "Favorites" },
  { value: "archive", label: "Archive" },
  { value: "recents", label: "Recents" },
];
export const LibraryViews = ({
  view,
  onSelect,
}: {
  view: LocalView;
  onSelect: (view: LocalView) => void;
}) => (
  <nav aria-label="Library views" className="flex gap-4">
    {views.map((entry) => (
      <button
        key={entry.value}
        type="button"
        aria-pressed={entry.value === view}
        onClick={() => onSelect(entry.value)}
      >
        {entry.label}
      </button>
    ))}
  </nav>
);
