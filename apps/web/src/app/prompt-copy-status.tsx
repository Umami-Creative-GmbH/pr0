import type { usePromptCopy } from "./use-prompt-copy";

export const PromptCopyStatus = ({
  copy,
}: {
  copy: ReturnType<typeof usePromptCopy>;
}) => (
  <div>
    <output>{copy.message}</output>
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
        Retry copy
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
          Retry usage
        </button>
        <button
          className="wf-btn"
          type="button"
          disabled={copy.busy}
          onClick={() => copy.discardUsage()}
        >
          Discard usage record
        </button>
      </div>
    ) : null}
  </div>
);
