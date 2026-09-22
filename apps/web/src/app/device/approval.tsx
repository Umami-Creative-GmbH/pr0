"use client";

import { useApiClient } from "@pr0/api-client/provider";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "../account-errors";

export const DeviceApproval = ({ initialCode }: { initialCode: string }) => {
  const client = useApiClient();
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);
  const account = useQuery({
    queryKey: ["device-browser-account"],
    queryFn: ({ signal }) => client.getLibrary(signal),
    retry: false,
    gcTime: 0,
  });
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setMessage(
        `${accountErrorMessage(error instanceof Error ? error : new Error("Approval failed"))} Return to the desktop and start a new approval if the code has expired or was already used.`
      );
    }
    setBusy(false);
    status.current?.focus();
  };
  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      await client.signIn({
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      form.reset();
      await account.refetch();
    });
  };
  const decide = (approve: boolean) => {
    const owner = account.data;
    if (!owner) {
      return;
    }
    void run(async () => {
      await client.decideDevice(
        { userCode: code, accountId: owner.account.id },
        approve
      );
      setFinished(true);
      setMessage(
        approve
          ? "Desktop approved. Return to pr0 on your computer."
          : "Desktop denied. No desktop sign-in was created."
      );
    });
  };
  return (
    <main className="mx-auto max-w-lg space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Approve your desktop</h1>
      <p>
        Only approve a code shown by pr0 on a computer you are signing into.
      </p>
      {!account.data && !finished ? (
        <form className="space-y-4" onSubmit={login}>
          <label className="block">
            Email
            <input
              autoComplete="username"
              className="block w-full rounded border p-2"
              name="email"
              required
              type="email"
            />
          </label>
          <label className="block">
            Password
            <input
              autoComplete="current-password"
              className="block w-full rounded border p-2"
              name="password"
              required
              type="password"
            />
          </label>
          <button className="wf-btn" disabled={busy} type="submit">
            Sign in
          </button>
          <p>
            <a className="underline" href="/" rel="noopener" target="_blank">
              Register, recover access, or use another sign-in method
            </a>
            . Then return to this tab.
          </p>
          <button
            className="wf-btn"
            disabled={busy}
            onClick={() => {
              void account.refetch();
            }}
            type="button"
          >
            Check sign-in
          </button>
        </form>
      ) : null}
      {account.data && !finished ? (
        <section className="space-y-4">
          <p>
            Account: <strong>{account.data.account.email}</strong>
          </p>
          <p>Server: {account.data.instance.origin}</p>
          <label className="block">
            Matching desktop code
            <input
              className="block w-full rounded border p-2 font-mono text-xl"
              maxLength={8}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              value={code}
            />
          </label>
          <p>
            Check that this code matches the one on your desktop. Approval
            creates a separate desktop session for this account.
          </p>
          <div className="flex gap-3">
            <button
              className="wf-btn"
              disabled={busy || !/^[A-Z2-9]{8}$/u.test(code)}
              onClick={() => decide(true)}
              type="button"
            >
              Approve matching code
            </button>
            <button
              className="wf-btn"
              disabled={busy}
              onClick={() => decide(false)}
              type="button"
            >
              Deny
            </button>
          </div>
          <a className="underline" href="/" rel="noopener" target="_blank">
            Manage or change the browser account
          </a>
        </section>
      ) : null}
      <p aria-live="polite" ref={status} tabIndex={-1}>
        {message}
      </p>
    </main>
  );
};
