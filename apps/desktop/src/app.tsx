import { AuthLayout } from "@pr0/ui/components/auth-layout";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { WayfinderShell } from "@pr0/ui/components/wayfinder-shell";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { useState } from "react";

import { SignInForm, SignOutControl } from "./auth-panels";
import { DownloadedLibrary } from "./downloaded-library";
import { LauncherEntry } from "./launcher-entry";
import { ResidentControls } from "./resident-controls";
import type { AuthRun, Status } from "./use-auth-session";
import { useAuthSession } from "./use-auth-session";

const RetainedLibrary = ({
  status,
  refreshAuth,
  editingDisabled,
  onEditing,
}: {
  status?: Status;
  refreshAuth: (command: "auth_status") => Promise<Status | undefined>;
  editingDisabled: boolean;
  onEditing: (editing: boolean) => void;
}) =>
  status?.accountId && status.state !== "cleanup_required" ? (
    <DownloadedLibrary
      key={`${status.instanceId}:${status.accountId}`}
      signedIn={status.state === "signed_in"}
      account={status}
      refreshAuth={refreshAuth}
      editingDisabled={editingDisabled}
      onEditing={onEditing}
    />
  ) : null;

const desktopKeys = translate("navigateCopySearch");
const hasLibrary = (status?: Status) =>
  Boolean(status?.accountId) && status?.state !== "cleanup_required";

const blocksEditing = (open: boolean, busy: boolean, status?: Status) =>
  open || busy || status?.state === "synchronizing_sign_out";

const needsSignIn = (status?: Status) =>
  status?.state === "signed_out" || status?.state === "authentication_required";

const ApprovalPanel = ({
  status,
  busy,
  run,
}: {
  status: Status;
  busy: boolean;
  run: AuthRun;
}) => {
  const t = useTranslations();
  return (
    <section className="flex flex-col gap-4">
      <span className="wf-eyebrow-accent">{t("browserApproval")}</span>
      <h2>{t("approveTheMatchingCode")}</h2>
      <p className="wf-hint">
        {t("server")} {status.origin}
      </p>
      <p className="wf-code-value">{status.userCode}</p>
      <p className="wf-hint">
        {t("signInAndExplicitlyApproveThisCodeInYourBrowser")}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="wf-btn-accent"
          disabled={busy}
          onClick={() => {
            void run("auth_open_browser");
          }}
          type="button"
        >
          {t("openBrowser")}
        </button>
        <button
          className="wf-btn"
          onClick={() => {
            void run("auth_cancel");
          }}
          type="button"
        >
          {t("cancelApproval")}
        </button>
      </div>
    </section>
  );
};

const AccountPanels = ({
  status,
  busy,
  run,
}: {
  status: Status;
  busy: boolean;
  run: AuthRun;
}) => {
  const t = useTranslations();
  return (
    <>
      {status.email ? (
        <section aria-label={t("currentAccount")} className="wf-card">
          <h2>{t("currentAccount")}</h2>
          <p>{status.email}</p>
          <p className="wf-hint break-all">
            {t("server")} {status.origin}
          </p>
          <p className="wf-mono break-all">
            {t("accountId")} {status.accountId}
          </p>
        </section>
      ) : null}
      {status.state === "signed_in" ? (
        <section className="wf-card">
          <h2>{t("signedInOnThisComputer")}</h2>
          <p className="wf-hint">
            {t("yourSignInIsStoredUnderYourWindowsAccount")}
          </p>
          <button
            className="wf-btn self-start"
            disabled={busy}
            onClick={() => {
              void run("auth_refresh");
            }}
            type="button"
          >
            {t("checkConnection")}
          </button>
        </section>
      ) : null}
    </>
  );
};

const AccountPage = ({
  status,
  busy,
  run,
  library,
  editing,
  hidden,
  onBack,
  onTransition,
}: {
  status?: Status;
  busy: boolean;
  run: AuthRun;
  library: boolean;
  editing: boolean;
  hidden: boolean;
  onBack: () => void;
  onTransition: (open: boolean) => void;
}) => {
  const t = useTranslations();
  return (
    <div className="wf-page" hidden={hidden}>
      {library ? (
        <div className="flex items-center justify-between gap-3">
          <h2>{t("accountAndConnection")}</h2>
          <button className="wf-btn" type="button" onClick={onBack}>
            {t("backToLibrary")}
          </button>
        </div>
      ) : null}
      {status ? <AccountPanels busy={busy} run={run} status={status} /> : null}
      {status && library && needsSignIn(status) ? (
        <section className="wf-card">
          <SignInForm busy={busy} run={run} status={status} />
        </section>
      ) : null}
      {status?.state === "awaiting_approval" && library ? (
        <section className="wf-card">
          <ApprovalPanel busy={busy} run={run} status={status} />
        </section>
      ) : null}
      {status && (status.accountId || status.state === "cleanup_required") ? (
        <section className="wf-card">
          <SignOutControl
            busy={busy}
            run={run}
            status={status}
            editing={editing}
            onTransition={onTransition}
          />
        </section>
      ) : null}
      {status ? null : (
        <button
          className="wf-btn self-start"
          disabled={busy}
          onClick={() => {
            void run("auth_status");
          }}
          type="button"
        >
          {t("retryLoadingSignIn")}
        </button>
      )}
    </div>
  );
};

const SignedOutView = ({
  status,
  busy,
  run,
}: {
  status?: Status;
  busy: boolean;
  run: AuthRun;
}) => {
  if (!status) {
    return null;
  }
  if (needsSignIn(status)) {
    return (
      <AuthLayout keys={desktopKeys}>
        <SignInForm busy={busy} run={run} status={status} />
      </AuthLayout>
    );
  }
  return status.state === "awaiting_approval" ? (
    <AuthLayout keys={desktopKeys}>
      <ApprovalPanel busy={busy} run={run} status={status} />
    </AuthLayout>
  ) : null;
};

export const App = () => {
  const t = useTranslations();

  const { status, busy, error, notice, run } = useAuthSession();
  const [editing, setEditing] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const library = hasLibrary(status);
  // Without a library, the account view is the whole window.
  const showAccount = accountOpen || !library;
  const statusText = error || status?.message || (busy ? t("working") : "");
  return (
    <WayfinderShell
      surface="desktop"
      identity={status?.email}
      actions={<LauncherEntry />}
      menu={
        library ? (
          <button
            className="wf-menu-item"
            type="button"
            onClick={() => setAccountOpen(!accountOpen)}
          >
            {accountOpen ? t("backToLibrary") : t("accountAndConnection")}
          </button>
        ) : null
      }
    >
      <ResidentControls>
        <main className="wf-main">
          <h1 className="sr-only">{t("yourPersonalPromptLibrary")}</h1>
          <p
            aria-live="polite"
            className="wf-banner"
            ref={notice}
            tabIndex={-1}
          >
            <LocalizedMessage value={statusText} />
          </p>
          <div className="contents" hidden={showAccount}>
            <RetainedLibrary
              status={status}
              refreshAuth={run}
              onEditing={setEditing}
              editingDisabled={blocksEditing(transitionOpen, busy, status)}
            />
          </div>
          {library ? null : (
            <SignedOutView busy={busy} run={run} status={status} />
          )}
          <AccountPage
            busy={busy}
            editing={editing}
            hidden={!showAccount}
            library={library}
            run={run}
            status={status}
            onBack={() => setAccountOpen(false)}
            onTransition={setTransitionOpen}
          />
        </main>
      </ResidentControls>
    </WayfinderShell>
  );
};
