import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { DesktopUsageStatus } from "@pr0/api-contract/desktop-copy";
import type { LocalOrganization } from "@pr0/api-contract/local-organization";
import type { UploadStatus } from "@pr0/api-contract/local-prompts";
import { Toast } from "@pr0/ui/components/toast";
import type { ReactNode } from "react";

import type { DownloadStatus } from "./library-client";
import { LocalLibraryStatus } from "./local-library-status";
import { OrganizationAttention } from "./organization-attention";
import { PendingRecovery } from "./pending-recovery";
import { UsageStatus } from "./usage-status";
import type { Status } from "./use-auth-session";
import type { useLifecycle } from "./use-lifecycle";

const usageInToast = (copyMessage: string, usage?: DesktopUsageStatus) =>
  Boolean(copyMessage) || Boolean(usage?.memoryOnly);

/** Only a finished copy with nothing left to act on may leave the screen. */
const plainSuccess = (
  copyMessage: string,
  lifecycle: ReturnType<typeof useLifecycle>,
  usage?: DesktopUsageStatus
) =>
  copyMessage === "Copied." &&
  !lifecycle.message &&
  !lifecycle.failed &&
  !usage?.memoryOnly &&
  !usage?.waiting &&
  !usage?.awaitingDownload &&
  !usage?.error;

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
  organization,
  onOrganizationSaved,
  onEditing,
  children,
  saveFailure,
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
  organization?: LocalOrganization;
  onOrganizationSaved: () => Promise<void>;
  onEditing: (value: boolean) => void;
  children?: ReactNode;
  saveFailure?: boolean;
}) => (
  <>
    <Toast
      signal={`${copyMessage}:${lifecycle.message}`}
      transient={plainSuccess(copyMessage, lifecycle, usage)}
    >
      <output>{copyMessage}</output>
      <output>{lifecycle.message}</output>
      {/* Usage feedback accompanies the copy result. Uses held only in memory
          can be lost on exit, so their retry always stays in view. */}
      {usageInToast(copyMessage, usage) ? (
        <UsageStatus status={usage} onRetry={onRetryUsage} />
      ) : null}
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
    </Toast>
    <LocalLibraryStatus
      saveFailure={saveFailure}
      status={status}
      signedIn={signedIn}
      offline={offline}
      upload={upload}
      changes={changes}
      onOpen={onOpen}
      onRetry={onRetryUpload}
      organizationAttention={organization?.pending.some((entry) =>
        Boolean(entry.error)
      )}
    >
      {usageInToast(copyMessage, usage) ? null : (
        <UsageStatus status={usage} onRetry={onRetryUsage} />
      )}
      <PendingRecovery
        account={account}
        upload={upload}
        onChanged={onRetry}
        disabled={editing || lifecycle.busy}
      />
      {organization ? (
        <OrganizationAttention
          account={account}
          snapshot={organization}
          onSaved={onOrganizationSaved}
          disabled={editing || lifecycle.busy}
          onEditing={onEditing}
        />
      ) : null}
      {children}
    </LocalLibraryStatus>
  </>
);
