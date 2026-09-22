import { AuthLayout } from "@pr0/ui/components/auth-layout";
import { WayfinderShell } from "@pr0/ui/components/wayfinder-shell";
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

const desktopKeys = "↑↓ Navigate ⦁ ↵ Copy ⦁ / Search";
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
}) => (
  <section className="flex flex-col gap-4">
    <span className="wf-eyebrow-accent">Browser approval</span>
    <h2>Approve the matching code</h2>
    <p className="wf-hint">Server: {status.origin}</p>
    <p className="wf-code-value">{status.userCode}</p>
    <p className="wf-hint">
      Sign in and explicitly approve this code in your browser. This window will
      update automatically.
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
        Open browser
      </button>
      <button
        className="wf-btn"
        onClick={() => {
          void run("auth_cancel");
        }}
        type="button"
      >
        Cancel approval
      </button>
    </div>
  </section>
);

const AccountPanels = ({
  status,
  busy,
  run,
}: {
  status: Status;
  busy: boolean;
  run: AuthRun;
}) => (
  <>
    {status.email ? (
      <section aria-label="Current account" className="wf-card">
        <h2>Current account</h2>
        <p>{status.email}</p>
        <p className="wf-hint break-all">Server: {status.origin}</p>
        <p className="wf-mono break-all">Account ID: {status.accountId}</p>
      </section>
    ) : null}
    {status.state === "signed_in" ? (
      <section className="wf-card">
        <h2>Signed in on this computer</h2>
        <p className="wf-hint">
          Your sign-in is stored under your Windows account.
        </p>
        <button
          className="wf-btn self-start"
          disabled={busy}
          onClick={() => {
            void run("auth_refresh");
          }}
          type="button"
        >
          Check connection
        </button>
      </section>
    ) : null}
  </>
);

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
}) => (
  <div className="wf-page" hidden={hidden}>
    {library ? (
      <div className="flex items-center justify-between gap-3">
        <h2>Account and connection</h2>
        <button className="wf-btn" type="button" onClick={onBack}>
          Back to library
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
        Retry loading sign-in
      </button>
    )}
  </div>
);

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
  const { status, busy, error, notice, run } = useAuthSession();
  const [editing, setEditing] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const library = hasLibrary(status);
  // Without a library, the account view is the whole window.
  const showAccount = accountOpen || !library;
  const statusText = error || status?.message || (busy ? "Working…" : "");
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
            {accountOpen ? "Back to library" : "Account and connection"}
          </button>
        ) : null
      }
    >
      <ResidentControls>
        <main className="wf-main">
          <h1 className="sr-only">Your personal prompt library</h1>
          <p
            aria-live="polite"
            className="wf-banner"
            ref={notice}
            tabIndex={-1}
          >
            {statusText}
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
