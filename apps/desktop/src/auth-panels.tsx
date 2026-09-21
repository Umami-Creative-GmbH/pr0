import type { SignOutRequest } from "@pr0/api-contract/desktop-session";
import { useState } from "react";
import type { FormEvent } from "react";

import type { Status, AuthRun } from "./use-auth-session";

interface PanelProps {
  busy: boolean;
  status: Status;
  run: AuthRun;
}
export const SignInForm = ({ busy, status, run }: PanelProps) => {
  const [origin, setOrigin] = useState(import.meta.env.VITE_API_BASE_URL ?? "");
  const [custom, setCustom] = useState(!import.meta.env.VITE_API_BASE_URL);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run("auth_begin", status.origin ?? origin);
  };
  return (
    <form className="space-y-4" onSubmit={submit}>
      <h2 className="text-xl font-semibold">
        {status.state === "authentication_required"
          ? "Sign in to resume"
          : "Sign in to pr0"}
      </h2>
      <p>
        Choose a server you trust. You will approve a matching code in your
        system browser.
      </p>
      {custom || status.origin ? (
        <label className="block">
          HTTPS server
          <input
            className="mt-2 block w-full rounded border p-2"
            disabled={busy || Boolean(status.origin)}
            onChange={(event) => setOrigin(event.target.value)}
            placeholder="https://your-server.example"
            required
            type="url"
            value={status.origin ?? origin}
          />
        </label>
      ) : (
        <>
          <p>Server: {origin}</p>
          <button
            className="underline"
            onClick={() => setCustom(true)}
            type="button"
          >
            Use your own server
          </button>
        </>
      )}
      <button
        className="block rounded border px-4 py-2"
        disabled={busy}
        type="submit"
      >
        Continue in browser
      </button>
    </form>
  );
};
export const SignOutControl = ({
  busy,
  status,
  run,
  editing,
  onTransition,
}: PanelProps & {
  editing: boolean;
  onTransition: (active: boolean) => void;
}) => {
  const [confirm, setConfirm] = useState(false);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [synchronizing, setSynchronizing] = useState(false);
  const choose = async (choice: SignOutRequest["choice"]) => {
    if (!status.instanceId || !status.accountId) {
      return;
    }
    setSynchronizing(choice === "synchronize");
    const result = await run("auth_sign_out", {
      instanceId: status.instanceId,
      accountId: status.accountId,
      generation: status.generation,
      choice,
      discardConfirmed,
    });
    setSynchronizing(false);
    if (result && (choice === "cancel" || result.state === "signed_out")) {
      setConfirm(false);
      setDiscardConfirmed(false);
      onTransition(false);
    }
  };
  if (status.state === "cleanup_required") {
    return (
      <section className="space-y-3" aria-label="Account cleanup">
        <p>
          Account cleanup is incomplete. Retry before signing into another
          account or server.
        </p>
        <button
          className="rounded border px-4 py-2"
          type="button"
          disabled={busy}
          onClick={() => {
            void choose("retry_cleanup");
          }}
        >
          Retry account cleanup
        </button>
      </section>
    );
  }
  return (
    <section className="space-y-3" aria-label="Sign out or change server">
      {confirm ? (
        <>
          <h2 className="text-xl font-semibold">Before you sign out</h2>
          <p>
            This removes this computer&apos;s library and sign-in. Synchronize
            pending changes first, or explicitly discard them. You can then
            choose another account or server.
          </p>
          <p>
            If you are offline, server revocation cannot be confirmed. Revoke
            this desktop session from browser settings when online. Browser
            sign-in is separate.
          </p>
          {synchronizing ? (
            <output>
              Synchronizing before sign-out. Waiting for server acknowledgement…
            </output>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded border px-4 py-2"
              disabled={busy}
              onClick={() => {
                void choose("synchronize");
              }}
              type="button"
            >
              Synchronize first and sign out
            </button>
            <button
              className="rounded border px-4 py-2"
              disabled={busy && !synchronizing}
              onClick={() => {
                void choose("cancel");
              }}
              type="button"
            >
              Cancel sign-out
            </button>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={discardConfirmed}
              disabled={busy}
              onChange={(event) => setDiscardConfirmed(event.target.checked)}
            />
            I understand that pending changes on this device will be lost
          </label>
          <button
            className="rounded border px-4 py-2"
            disabled={busy || !discardConfirmed}
            onClick={() => {
              void choose("discard");
            }}
            type="button"
          >
            Discard local work and sign out
          </button>
        </>
      ) : (
        <>
          <button
            className="rounded border px-4 py-2"
            disabled={busy || editing || status.state === "awaiting_approval"}
            onClick={() => {
              setConfirm(true);
              onTransition(true);
            }}
            type="button"
          >
            Sign out or change server
          </button>
          {editing ? (
            <p>
              Save or close the prompt editor before signing out. Your draft
              remains open.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
};
