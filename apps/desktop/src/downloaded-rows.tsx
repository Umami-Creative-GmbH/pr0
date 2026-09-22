import type { DownloadedSummary } from "./library-client";

export const DownloadedRows = ({
  rows,
  offset,
  recents,
  copying,
  onOpen,
  onCopy,
  onBrowse,
  onFavorite,
  changing,
}: {
  rows: DownloadedSummary[];
  offset: number;
  recents: boolean;
  copying: boolean;
  onOpen: (id: string) => Promise<void>;
  onCopy: (id: string) => Promise<void>;
  onBrowse: (offset: number) => Promise<void>;
  onFavorite: (id: string) => Promise<void>;
  changing: boolean;
}) => (
  <>
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap gap-2">
          <button
            className="wf-btn"
            type="button"
            disabled={changing}
            aria-label={`Toggle favorite for ${row.title}`}
            onClick={() => {
              void onFavorite(row.id);
            }}
          >
            Favorite
          </button>
          <button
            className="wf-btn"
            type="button"
            onClick={() => {
              void onOpen(row.id);
            }}
          >
            {row.title}
            {row.archived ? " (Archived)" : ""}
            <span className="wf-row-preview">{row.excerpt}</span>
          </button>
          <button
            className="wf-btn"
            type="button"
            aria-label={`Copy ${row.title}`}
            disabled={copying}
            onClick={() => {
              void onCopy(row.id);
            }}
          >
            Copy
          </button>
        </li>
      ))}
    </ul>
    {recents && rows.length === 0 ? (
      <p>
        Copied active prompts appear in Recents. Uses are ordered by when they
        happened.
      </p>
    ) : null}
    <nav aria-label="Downloaded prompt pages" className="flex gap-4">
      <button
        type="button"
        disabled={offset === 0}
        onClick={() => {
          void onBrowse(Math.max(0, offset - 50));
        }}
      >
        Previous
      </button>
      <button
        type="button"
        disabled={rows.length < 50}
        onClick={() => {
          void onBrowse(offset + 50);
        }}
      >
        Next
      </button>
    </nav>
  </>
);
