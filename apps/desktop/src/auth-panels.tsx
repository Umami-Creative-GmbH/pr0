import { useState } from "react";
import type { FormEvent } from "react";

import type { Status, Command } from "./use-auth-session";

interface PanelProps {
  busy: boolean;
  status: Status;
  run: (name: Command, origin?: string) => Promise<void>;
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
export const SignOutControl = ({ busy, status, run }: PanelProps) => {
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="space-y-3">
      {confirm ? (
        <>
          <p>
            Remove this computer&apos;s sign-in? This version has no downloaded
            library. If server revocation cannot be confirmed, you can revoke
            the session from browser settings.
          </p>
          <div className="flex gap-4">
            <button
              className="rounded border px-4 py-2"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                void run("auth_sign_out");
              }}
              type="button"
            >
              Confirm sign out
            </button>
            <button
              className="rounded border px-4 py-2"
              onClick={() => setConfirm(false)}
              type="button"
            >
              Keep signed in
            </button>
          </div>
        </>
      ) : (
        <button
          className="rounded border px-4 py-2"
          disabled={busy}
          onClick={() => setConfirm(true)}
          type="button"
        >
          {status.state === "cleanup_required"
            ? "Retry sign-out cleanup"
            : "Sign out or change server"}
        </button>
      )}
    </section>
  );
};
