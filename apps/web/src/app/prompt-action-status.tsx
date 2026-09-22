"use client";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";

import type { usePromptActions } from "./use-prompt-actions";

const buttonClass = "wf-btn";
export const PromptActionStatus = ({
  actions,
}: {
  actions: ReturnType<typeof usePromptActions>;
}) => {
  const t = useTranslations();
  return (
    <>
      {actions.busy ? <output>{t("confirmingAction")}</output> : null}
      {actions.error ? (
        <div
          id="prompt-action-recovery"
          role="alert"
          className="space-y-3 rounded-md border p-4"
        >
          <p>
            <LocalizedMessage value={actions.error} />
          </p>
          {actions.canRetry ? (
            <button
              className={buttonClass}
              type="button"
              disabled={actions.busy}
              onClick={() => {
                void actions.retry();
              }}
            >
              {t("retryAction")}
            </button>
          ) : null}
          {actions.knownRejected ? (
            <button
              className={buttonClass}
              type="button"
              disabled={actions.busy}
              onClick={() => actions.dismiss()}
            >
              {t("dismissAction")}
            </button>
          ) : null}
          {actions.retainedText ? (
            <>
              <p className="break-words">
                {t("selectedTitle")} {actions.retainedText.title}
              </p>
              <p className="break-words whitespace-pre-wrap">
                {actions.retainedText.description}
              </p>
              <textarea
                aria-label={t("retainedDuplicateContent")}
                className="w-full rounded-md border p-3"
                readOnly
                value={actions.retainedText.content}
              />
              <button
                className={buttonClass}
                type="button"
                onClick={() => {
                  void actions.copy();
                }}
              >
                {t("copyRetainedText")}
              </button>
              <p aria-live="polite">{actions.copyMessage}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
};
