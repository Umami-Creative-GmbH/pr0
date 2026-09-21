import { SignInForm, SignOutControl } from "./auth-panels";
import { DownloadedLibrary } from "./downloaded-library";
import type { Status } from "./use-auth-session";
import { useAuthSession } from "./use-auth-session";

const RetainedLibrary = ({
  status,
  refreshAuth,
}: {
  status?: Status;
  refreshAuth: (command: "auth_status") => Promise<void>;
}) =>
  status?.accountId && status.state !== "cleanup_required" ? (
    <DownloadedLibrary
      key={`${status.instanceId}:${status.accountId}:${status.generation}`}
      signedIn={status.state === "signed_in"}
      account={status}
      refreshAuth={refreshAuth}
    />
  ) : null;

export const App = () => {
  const { status, busy, error, notice, run } = useAuthSession();
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-3xl font-semibold">pr0</h1>
      <p>Your personal prompt library</p>
      {status?.email ? (
        <section
          aria-label="Current account"
          className="space-y-2 rounded border p-4"
        >
          <h2 className="text-lg font-medium">Current account</h2>
          <p>{status.email}</p>
          <p className="break-all">Server: {status.origin}</p>
        </section>
      ) : null}
      {status?.state === "signed_in" ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Signed in on this computer</h2>
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
      <RetainedLibrary status={status} refreshAuth={run} />
      {status?.state === "signed_out" ||
      status?.state === "authentication_required" ? (
        <SignInForm busy={busy} run={run} status={status} />
      ) : null}
      {status?.state === "awaiting_approval" ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Approve the matching code</h2>
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
      {status && (status.accountId || status.state === "cleanup_required") ? (
        <SignOutControl busy={busy} run={run} status={status} />
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
    </main>
  );
};
