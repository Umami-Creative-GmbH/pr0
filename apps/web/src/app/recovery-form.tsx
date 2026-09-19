"use client";

import { useApiClient } from "@pr0/api-client/provider";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "./account-errors";

export const RecoveryForm = () => {
  const client = useApiClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setBusy(true);
    setMessage("");
    try {
      await client.requestRecovery(email);
      setMessage(
        "If this address belongs to a verified account, a recovery email has been queued. Check your inbox and spam folder. If it does not arrive, try again later. The link expires one hour after you request it."
      );
    } catch (error) {
      setMessage(
        accountErrorMessage(
          error instanceof Error ? error : new Error("Recovery failed")
        )
      );
    }
    setBusy(false);
    statusRef.current?.focus();
  };
  return (
    <section aria-labelledby="recovery-title" className="rounded-lg border p-6">
      <h2 className="text-xl font-medium" id="recovery-title">
        Recover your account
      </h2>
      <p className="mt-2 text-sm">
        Use your verified account email, including if you usually sign in with a
        social provider.
      </p>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <label className="block" htmlFor="recovery-email">
          Account email
        </label>
        <input
          autoComplete="email"
          className="bg-background w-full rounded-md border px-3 py-2"
          disabled={busy}
          id="recovery-email"
          maxLength={254}
          name="email"
          required
          type="email"
        />
        <button
          className="rounded-md border px-4 py-2"
          disabled={busy}
          type="submit"
        >
          {busy ? "Please wait…" : "Send recovery email"}
        </button>
      </form>
      <p
        aria-live="polite"
        className="mt-4 text-sm"
        ref={statusRef}
        tabIndex={-1}
      >
        {message}
      </p>
    </section>
  );
};
