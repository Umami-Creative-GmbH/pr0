"use client";
import type { usePromptActions } from "./use-prompt-actions";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
export const PromptActionStatus = ({
  actions,
}: {
  actions: ReturnType<typeof usePromptActions>;
}) => (
  <>
    {actions.busy ? <output>Confirming action…</output> : null}
    {actions.error ? (
      <div
        id="prompt-action-recovery"
        role="alert"
        className="space-y-3 rounded-md border p-4"
      >
        <p>{actions.error}</p>
        {actions.canRetry ? (
          <button
            className={buttonClass}
            type="button"
            disabled={actions.busy}
            onClick={() => {
              void actions.retry();
            }}
          >
            Retry action
          </button>
        ) : null}
        {actions.knownRejected ? (
          <button
            className={buttonClass}
            type="button"
            disabled={actions.busy}
            onClick={() => actions.dismiss()}
          >
            Dismiss action
          </button>
        ) : null}
        {actions.retainedText ? (
          <>
            <p className="break-words">
              Selected title: {actions.retainedText.title}
            </p>
            <p className="break-words whitespace-pre-wrap">
              {actions.retainedText.description}
            </p>
            <textarea
              aria-label="Retained duplicate content"
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
              Copy retained text
            </button>
            <p aria-live="polite">{actions.copyMessage}</p>
          </>
        ) : null}
      </div>
    ) : null}
  </>
);
