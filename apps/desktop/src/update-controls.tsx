import type { UpdateStatus } from "@pr0/api-contract/desktop-update";

import { updateClient } from "./update-client";
import { useApplicationUpdates } from "./use-application-updates";

const errors = {
  check_failed: "Could not check for updates. Check your connection and retry.",
  download_failed:
    "The download failed. Your saved work is unchanged. Retry the download.",
  verification_failed:
    "The update signature could not be verified. Nothing was installed. Retry later or contact your application distributor.",
  install_failed:
    "The update did not complete. Your local library and pending work remain on this device. Retry, or quit pr0 and run the signed installer from your application distributor.",
  storage_unavailable:
    "Could not prepare the update on this device. Check available disk space and access, then retry.",
};

type UpdatePhase = UpdateStatus["phase"] | undefined;
type PerformUpdate = (operation: () => Promise<void>) => Promise<void>;

const phaseMessages: Partial<Record<UpdateStatus["phase"], string>> = {
  unconfigured:
    "This build has no update signing configuration. Contact your application distributor for a signed release.",
  current: "You are up to date.",
  ready:
    "Download verified. Install and restart when you are ready; unsaved changes will be reviewed first.",
};

const isWorking = (phase: UpdatePhase, busy: boolean) =>
  busy || phase === "downloading" || phase === "checking";

const UpdateSummary = ({
  status,
  busy,
}: {
  status: UpdateStatus | undefined;
  busy: boolean;
}) => (
  <output>
    {status?.version
      ? `pr0 ${status.version} is available. `
      : "Application updates. "}
    {status ? phaseMessages[status.phase] : null}
    {isWorking(status?.phase, busy) ? "Working…" : null}
  </output>
);

const UpdateActions = ({
  phase,
  busy,
  perform,
}: {
  phase: UpdatePhase;
  busy: boolean;
  perform: PerformUpdate;
}) => (
  <>
    {phase === "available" ? (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void perform(updateClient.download);
        }}
      >
        Download update
      </button>
    ) : null}
    {phase === "ready" ? (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void perform(updateClient.install);
        }}
      >
        Install update and restart
      </button>
    ) : null}
    {phase !== "unconfigured" && phase !== "ready" ? (
      <button
        type="button"
        disabled={isWorking(phase, busy)}
        onClick={() => {
          void perform(updateClient.check);
        }}
      >
        Check for updates
      </button>
    ) : null}
  </>
);

export const UpdateControls = () => {
  const { status, busy, error, perform } = useApplicationUpdates();
  return (
    <section aria-label="Application updates" className="wf-banner">
      <UpdateSummary status={status} busy={busy} />
      {status?.error ? <p role="alert">{errors[status.error]}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <UpdateActions phase={status?.phase} busy={busy} perform={perform} />
    </section>
  );
};
