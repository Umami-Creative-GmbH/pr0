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
  <nav aria-label="Library views" className="flex flex-wrap gap-2">
    {views.map((entry) => (
      <button
        key={entry.value}
        className="aria-pressed:bg-secondary rounded border px-3 py-2 aria-pressed:font-semibold"
        type="button"
        aria-pressed={entry.value === view}
        onClick={() => onSelect(entry.value)}
      >
        {entry.label}
      </button>
    ))}
  </nav>
);
