import type { LocalView } from "@pr0/api-contract/local-prompts";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";

const views: { value: LocalView; label: string }[] = [
  { value: "all", label: translate("allDownloadedPrompts") },
  { value: "favorites", label: translate("favorites") },
  { value: "archive", label: translate("archive") },
  { value: "recents", label: translate("recents") },
];
export const LibraryViews = ({
  view,
  onSelect,
}: {
  view: LocalView;
  onSelect: (view: LocalView) => void;
}) => {
  const t = useTranslations();
  return (
    <nav aria-label={t("libraryViews")} className="flex flex-wrap gap-2">
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
};
