/** PROTOTYPE (issue #9) — window chrome above the library. */

import { useTranslate } from "@tolgee/react";
import { CloudCheck, Command, Search } from "lucide-react";

export interface LibraryChromeProps {
  surface: "web" | "desktop";
  /** Which global shortcut registered, already localised. */
  statusNote?: string;
  onOpenLauncher: () => void;
}

export const LibraryChrome = ({
  surface,
  statusNote,
  onOpenLauncher,
}: LibraryChromeProps) => {
  const { t } = useTranslate();

  return (
    <div className="pr0-chrome">
      <div className="pr0-traffic">
        <span style={{ background: "#FF5F57" }} />
        <span style={{ background: "#FEBC2E" }} />
        <span style={{ background: "#28C840" }} />
      </div>
      <span className="pr0-wordmark" style={{ fontSize: 16 }}>
        pr
        <span>0</span>
      </span>

      {surface === "web" ? (
        <button className="pr0-omnibar" onClick={onOpenLauncher} type="button">
          <Search aria-hidden="true" size={15} />
          <span style={{ flex: 1 }}>{t("chrome.quickAccess")}</span>
          <span className="pr0-kbd">&#8984;K</span>
        </button>
      ) : null}

      <span className="pr0-spacer" />

      {statusNote ? (
        <span className="pr0-status">
          <Command aria-hidden="true" size={13} />
          {statusNote}
        </span>
      ) : null}

      <span className="pr0-status">
        <CloudCheck aria-hidden="true" size={15} />
        {t("chrome.synced")}
      </span>

      {surface === "desktop" ? (
        <button className="pr0-pill" onClick={onOpenLauncher} type="button">
          <Command aria-hidden="true" size={13} />K
        </button>
      ) : null}

      <span className="pr0-avatar">JS</span>
    </div>
  );
};
