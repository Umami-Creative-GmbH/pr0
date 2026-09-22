import type { DesktopUsageStatus } from "@pr0/api-contract/desktop-copy";
import { useTranslations } from "@pr0/ui/hooks/use-translations";

import { upgradeRecoveryMessage } from "./upgrade-recovery";

export const UsageStatus = ({
  status,
  onRetry,
}: {
  status?: DesktopUsageStatus;
  onRetry: () => void;
}) => {
  const t = useTranslations();
  return (
    <section aria-label={t("promptUsage")}>
      {status?.memoryOnly ? (
        <p>
          {t("copiedBut")} {status.memoryOnly}{" "}
          {t("useSAreOnlyHeldInMemoryRetryUsageClosing")}
        </p>
      ) : null}
      {status?.waiting ? (
        <p>
          {status.waiting} {t("useSSavedOnThisDeviceWaitingToSync")}
        </p>
      ) : null}
      {status?.awaitingDownload && status.error !== "recovery_required" ? (
        <p>{t("usageAcceptedByTheServerUpdatingTheDownloadedLibrary")}</p>
      ) : null}
      {status?.error ? (
        <p>
          {upgradeRecoveryMessage(status.error) ??
            (status.error === "recovery_required"
              ? t("theServerWasRestoredEarlierUsageIsRetainedForRecovery")
              : t("usageSyncIsPausedCheckYourConnectionAndSignIn"))}
        </p>
      ) : null}
      {status?.memoryOnly ? (
        <button type="button" onClick={onRetry}>
          {t("retryUsage")}
        </button>
      ) : null}
    </section>
  );
};
