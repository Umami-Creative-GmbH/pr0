import type { UploadStatus } from "@pr0/api-contract/local-prompts";
import type { PromptError } from "@pr0/api-contract/prompts";
import { useTranslations } from "@pr0/ui/hooks/use-translations";

import { uploadFailureMessage } from "./upload-status";

const resources = {
  promptCount: "promptCount" as const,
  textBytes: "totalLibraryText" as const,
  collectionCount: "collectionCount" as const,
  tagCount: "tagCount" as const,
  tagsPerPrompt: "tagsPerPrompt" as const,
};
export const CapacityDetails = ({
  failure,
}: {
  failure?: PromptError | null;
}) => {
  const t = useTranslations();
  return (
    <>
      {failure?.resource ? (
        <p>
          {t("limitingResource")} {t(resources[failure.resource])}.
        </p>
      ) : null}
      {failure?.usage ? (
        <p>
          {t("serverUsage")} {failure.usage.promptCount} {t("prompts")}{" "}
          {failure.usage.textBytes} {t("bytesOfLibraryText")}
        </p>
      ) : null}
    </>
  );
};
export const RejectedChange = ({
  entry,
  deleting,
}: {
  entry: UploadStatus["errors"][number];
  deleting: boolean;
}) => {
  const t = useTranslations();
  return (
    <>
      <p>{uploadFailureMessage(entry.code)}</p>
      <CapacityDetails failure={entry.failure} />
      {entry.code === "quota_exceeded" ? (
        <p>
          {deleting
            ? t("deletionRemainsPendingTheServerOriginalWasNotDeletedBecause")
            : t("thisVariantIsRetainedOnThisDeviceRequiredPreservationHas")}
        </p>
      ) : null}
    </>
  );
};
