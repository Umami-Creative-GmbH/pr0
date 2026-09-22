import { useTranslations } from "@pr0/ui/hooks/use-translations";

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
}) => {
  const t = useTranslations();
  return (
    <>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap gap-2">
            <button
              className="wf-btn"
              type="button"
              disabled={changing}
              aria-label={t("toggleFavoriteForValue", [row.title])}
              onClick={() => {
                void onFavorite(row.id);
              }}
            >
              {t("favorite")}
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
              aria-label={t("copyValue", [row.title])}
              disabled={copying}
              onClick={() => {
                void onCopy(row.id);
              }}
            >
              {t("copy")}
            </button>
          </li>
        ))}
      </ul>
      {recents && rows.length === 0 ? (
        <p>{t("copiedActivePromptsAppearInRecentsUsesAreOrderedBy")}</p>
      ) : null}
      <nav aria-label={t("downloadedPromptPages")} className="flex gap-4">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => {
            void onBrowse(Math.max(0, offset - 50));
          }}
        >
          {t("previous")}
        </button>
        <button
          type="button"
          disabled={rows.length < 50}
          onClick={() => {
            void onBrowse(offset + 50);
          }}
        >
          {t("next")}
        </button>
      </nav>
    </>
  );
};
