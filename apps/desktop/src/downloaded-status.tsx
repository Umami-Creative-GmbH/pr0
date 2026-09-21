import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { DesktopUsageStatus } from "@pr0/api-contract/desktop-copy";
import type { UploadStatus } from "@pr0/api-contract/local-prompts";

import type { DownloadStatus } from "./library-client";
import { LocalLibraryStatus } from "./local-library-status";
import { PendingRecovery } from "./pending-recovery";
import { UsageStatus } from "./usage-status";
import type { Status } from "./use-auth-session";
import type { useLifecycle } from "./use-lifecycle";

export const DownloadedStatus = ({
  status,
  upload,
  changes,
  usage,
  account,
  lifecycle,
  signedIn,
  offline,
  editing,
  copyMessage,
  onRetry,
  onRetryUsage,
  onRetryUpload,
  onOpen,
}: {
  status?: DownloadStatus;
  upload?: UploadStatus;
  changes?: ChangeStatus;
  usage?: DesktopUsageStatus;
  account: Status;
  lifecycle: ReturnType<typeof useLifecycle>;
  signedIn: boolean;
  offline: boolean;
  editing: boolean;
  copyMessage: string;
  onRetry: () => void;
  onRetryUsage: () => void;
  onRetryUpload: () => void;
  onOpen: (id: string) => void;
}) => (
  <>
    <output>{copyMessage}</output>
    <output>{lifecycle.message}</output>
    {lifecycle.failed ? (
      <div role="alert" className="flex gap-3">
        <button
          type="button"
          disabled={lifecycle.busy}
          onClick={() => {
            void lifecycle.retry();
          }}
        >
          Retry action
        </button>
        <button
          type="button"
          onClick={() => {
            void lifecycle.copy();
          }}
        >
          Copy text
        </button>
      </div>
    ) : null}
    <UsageStatus status={usage} onRetry={onRetryUsage} />
    <PendingRecovery
      account={account}
      upload={upload}
      onChanged={onRetry}
      disabled={editing || lifecycle.busy}
    />
    <LocalLibraryStatus
      status={status}
      signedIn={signedIn}
      offline={offline}
      upload={upload}
      changes={changes}
      onOpen={onOpen}
      onRetry={onRetryUpload}
    />
  </>
);
