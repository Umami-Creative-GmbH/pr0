import { WayfinderShell } from "@pr0/ui/components/wayfinder-shell";
import { useState } from "react";

import { SignInForm, SignOutControl } from "./auth-panels";
import { DownloadedLibrary } from "./downloaded-library";
import { LauncherEntry } from "./launcher-entry";
import { ResidentControls } from "./resident-controls";
import type { Status } from "./use-auth-session";
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
      key={`${status.instanceId}:${status.accountId}:${status.generation}`}
      signedIn={status.state === "signed_in"}
      account={status}
      refreshAuth={refreshAuth}
      editingDisabled={editingDisabled}
      onEditing={onEditing}
    />
  ) : null;

const showAccount = (status?: Status) => !status?.accountId;

const blocksEditing = (open: boolean, busy: boolean, status?: Status) =>
  open || busy || status?.state === "synchronizing_sign_out";

export const App = () => {
  const { status, busy, error, notice, run } = useAuthSession();
  const [editing, setEditing] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  return (
    <WayfinderShell
      surface="desktop"
      identity={status?.email}
      actions={<LauncherEntry />}
    >
      <ResidentControls>
        <main>
          <h1 className="sr-only">Your personal prompt library</h1>
          <RetainedLibrary
            status={status}
            refreshAuth={run}
            onEditing={setEditing}
            editingDisabled={blocksEditing(transitionOpen, busy, status)}
          />
          <details className="wf-settings" open={showAccount(status)}>
            <summary>Account and connection</summary>
            {status?.email ? (
              <section
                aria-label="Current account"
                className="space-y-2 rounded border p-4"
              >
                <h2 className="text-lg font-medium">Current account</h2>
                <p>{status.email}</p>
                <p className="break-all">Server: {status.origin}</p>
                <p className="text-sm break-all">
                  Account ID: {status.accountId}
                </p>
              </section>
            ) : null}
            {status?.state === "signed_in" ? (
              <section className="space-y-4">
                <h2 className="text-xl font-semibold">
                  Signed in on this computer
                </h2>
                <p>Your sign-in is stored under your Windows account.</p>
                <button
                  className="rounded border px-4 py-2"
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
            {status?.state === "signed_out" ||
            status?.state === "authentication_required" ? (
              <SignInForm busy={busy} run={run} status={status} />
            ) : null}
            {status?.state === "awaiting_approval" ? (
              <section className="space-y-4">
                <h2 className="text-xl font-semibold">
                  Approve the matching code
                </h2>
                <p>Server: {status.origin}</p>
                <p className="font-mono text-3xl tracking-widest">
                  {status.userCode}
                </p>
                <p>
                  Sign in and explicitly approve this code in your browser. This
                  window will update automatically.
                </p>
                <div className="flex gap-4">
                  <button
                    className="rounded border px-4 py-2"
                    disabled={busy}
                    onClick={() => {
                      void run("auth_open_browser");
                    }}
                    type="button"
                  >
                    Open browser
                  </button>
                  <button
                    className="rounded border px-4 py-2"
                    onClick={() => {
                      void run("auth_cancel");
                    }}
                    type="button"
                  >
                    Cancel approval
                  </button>
                </div>
              </section>
            ) : null}
            {status &&
            (status.accountId || status.state === "cleanup_required") ? (
              <SignOutControl
                busy={busy}
                run={run}
                status={status}
                editing={editing}
                onTransition={setTransitionOpen}
              />
            ) : null}
            {status ? null : (
              <button
                className="rounded border px-4 py-2"
                disabled={busy}
                onClick={() => {
                  void run("auth_status");
                }}
                type="button"
              >
                Retry loading sign-in
              </button>
            )}
            <p aria-live="polite" ref={notice} tabIndex={-1}>
              {error || status?.message || (busy ? "Working…" : "")}
            </p>
          </details>
        </main>
      </ResidentControls>
    </WayfinderShell>
  );
};
