"use client";

import { useApiClient } from "@pr0/api-client/provider";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "../account-errors";
import { RecoveryForm } from "../recovery-form";

export const ResetPasswordForm = () => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const token = useRef("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const readToken = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get(
        "token"
      );
      if (value) {
        token.current = value;
        window.history.replaceState(null, "", window.location.pathname);
        setComplete(false);
        setMessage("");
      }
    };
    readToken();
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("password") ?? "");
    if (newPassword !== data.get("confirm-password")) {
      setMessage("The passwords do not match.");
      statusRef.current?.focus();
      return;
    }
    if (!token.current) {
      setMessage(
        "Open the link in your recovery email. If it is unavailable, request another email below."
      );
      statusRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await client.resetPassword({ token: token.current, newPassword });
      await queryClient.cancelQueries();
      queryClient.clear();
      token.current = "";
      form.reset();
      setComplete(true);
      setMessage(
        "Password changed. All previous sessions have ended. Sign in with your new password."
      );
    } catch (error) {
      setMessage(
        accountErrorMessage(
          error instanceof Error ? error : new Error("Reset failed")
        )
      );
    }
    setBusy(false);
    statusRef.current?.focus();
  };
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">Reset your password</h1>
      <p aria-live="polite" ref={statusRef} tabIndex={-1}>
        {message}
      </p>
      {complete ? null : (
        <>
          <p>
            Choose a password with 12–128 characters. This ends every previous
            browser and desktop session. Desktop work remains on its device.
          </p>
          <form className="space-y-4" onSubmit={submit}>
            <label className="block" htmlFor="password">
              New password
            </label>
            <input
              autoComplete="new-password"
              className="bg-background w-full rounded-md border px-3 py-2"
              disabled={busy}
              id="password"
              maxLength={128}
              minLength={12}
              name="password"
              required
              type="password"
            />
            <label className="block" htmlFor="confirm-password">
              Confirm new password
            </label>
            <input
              autoComplete="new-password"
              className="bg-background w-full rounded-md border px-3 py-2"
              disabled={busy}
              id="confirm-password"
              maxLength={128}
              minLength={12}
              name="confirm-password"
              required
              type="password"
            />
            <button
              className="bg-primary text-primary-foreground rounded-md px-4 py-2"
              disabled={busy}
              type="submit"
            >
              {busy ? "Please wait…" : "Reset password"}
            </button>
          </form>
          <RecoveryForm />
        </>
      )}
      <Link className="underline" href="/">
        Return to sign in
      </Link>
    </main>
  );
};
