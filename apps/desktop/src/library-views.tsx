export const LibraryViews = ({
  recents,
  onSelect,
}: {
  recents: boolean;
  onSelect: (recents: boolean) => void;
}) => (
  <nav aria-label="Library views" className="flex gap-4">
    <button
      type="button"
      aria-pressed={!recents}
      onClick={() => onSelect(false)}
    >
      All downloaded prompts
    </button>
    <button type="button" aria-pressed={recents} onClick={() => onSelect(true)}>
      Recents
    </button>
  </nav>
);
