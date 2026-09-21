import type { DesktopUsageStatus } from "@pr0/api-contract/desktop-copy";

export const UsageStatus = ({
  status,
  onRetry,
}: {
  status?: DesktopUsageStatus;
  onRetry: () => void;
}) => (
  <section aria-label="Prompt usage" aria-live="polite">
    {status?.memoryOnly ? (
      <p>
        Copied, but {status.memoryOnly} use(s) are only held in memory. Retry
        usage; closing the app may lose them.
      </p>
    ) : null}
    {status?.waiting ? (
      <p>{status.waiting} use(s) saved on this device, waiting to sync.</p>
    ) : null}
    {status?.awaitingDownload ? (
      <p>Usage accepted by the server. Updating the downloaded library.</p>
    ) : null}
    {status?.error ? (
      <p>
        Usage sync is paused. Check your connection and sign-in; saved uses will
        retry automatically.
      </p>
    ) : null}
    {status?.memoryOnly ? (
      <button type="button" onClick={onRetry}>
        Retry usage
      </button>
    ) : null}
  </section>
);
