import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";

import type { usePromptCopy } from "./use-prompt-copy";

export const PromptCopyStatus = ({
  copy,
}: {
  copy: ReturnType<typeof usePromptCopy>;
}) => {
  const t = useTranslations();
  return (
    <div>
      <output>
        <LocalizedMessage value={copy.message} />
      </output>
      {copy.retryId ? (
        <button
          className="wf-btn"
          type="button"
          disabled={copy.busy}
          onClick={() => {
            if (copy.retryId) {
              void copy.copy(copy.retryId);
            }
          }}
        >
          {t("retryCopy")}
        </button>
      ) : null}
      {copy.usagePending ? (
        <div className="flex gap-2">
          <button
            className="wf-btn"
            type="button"
            disabled={copy.busy}
            onClick={() => {
              void copy.retryUsage();
            }}
          >
            {t("retryUsage")}
          </button>
          <button
            className="wf-btn"
            type="button"
            disabled={copy.busy}
            onClick={() => copy.discardUsage()}
          >
            {t("discardUsageRecord")}
          </button>
        </div>
      ) : null}
    </div>
  );
};
