import { promptLimits } from "@pr0/api-contract/prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useLocale, useTranslations } from "@pr0/ui/hooks/use-translations";
import { localizedLabel } from "@pr0/ui/lib/i18n";

export const OrganizationCapacity = ({
  count,
  limit,
  plural,
  singular,
  textBytes,
  loading,
  error,
  onRetry,
}: {
  count: number;
  limit: number;
  plural: string;
  singular: string;
  textBytes: number;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) => {
  const locale = useLocale();

  const t = useTranslations();
  return (
    <>
      <p>
        {count} / {limit} {localizedLabel(plural)} ·{" "}
        {(textBytes / 1_048_576).toLocaleString(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}{" "}
        {t("text100MibLibraryText")}
      </p>
      <p className="text-muted-foreground text-sm">
        {t("countsAreLibraryWideIncludingTheArchiveForTheAvailable")}
      </p>
      {count >= limit * promptLimits.warningRatio ? (
        <output>
          {t("yourLibraryIsAtOrAbove90OfIts")} {limit.toLocaleString(locale)}{" "}
          {localizedLabel(singular)} {t("limit")}
        </output>
      ) : null}
      {textBytes >= promptLimits.libraryBytes * promptLimits.warningRatio ? (
        <output>{t("yourLibraryIsAtOrAbove90OfIts100")}</output>
      ) : null}
      {loading ? (
        <output>
          {t("loading")} {localizedLabel(plural)}…
        </output>
      ) : null}
      {error ? (
        <div role="alert">
          <LocalizedMessage value={error} />{" "}
          <button className="wf-btn" type="button" onClick={onRetry}>
            {t("retry")} {localizedLabel(plural)}
          </button>
        </div>
      ) : null}
    </>
  );
};
