"use client";

import { useApiClient } from "@pr0/api-client/provider";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "../account-errors";

export const SocialEmailForm = () => {
  const client = useApiClient();
  const token = useRef("");
  const status = useRef<HTMLParagraphElement>(null);
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const readToken = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get(
        "token"
      );
      if (value) {
        token.current = value;
        window.history.replaceState(null, "", window.location.pathname);
        setHasToken(true);
      }
    };
    readToken();
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setBusy(true);
    try {
      if (hasToken) {
        await client.verifySocialEmail(token.current);
        token.current = "";
        window.location.assign("/");
      } else {
        await client.requestSocialEmail(email);
        setMessage(
          "Check your inbox and spam folder. Open the verification link in this browser, then confirm to enter your library. You can request another email here; only the newest link works."
        );
      }
    } catch (error) {
      setMessage(
        accountErrorMessage(
          error instanceof Error ? error : new Error("Verification failed")
        )
      );
    }
    setBusy(false);
    status.current?.focus();
  };
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">Verify your account email</h1>
      <p>
        Your provider did not supply a usable verified email. Verify an address
        for your account and recovery before opening your library. Complete this
        step in the browser where you started sign-in, within one hour.
      </p>
      <p aria-live="polite" ref={status} tabIndex={-1}>
        {message}
      </p>
      <form className="space-y-4" onSubmit={submit}>
        {hasToken ? null : (
          <>
            <label className="block font-medium" htmlFor="social-email">
              Account email
            </label>
            <input
              autoComplete="email"
              className="bg-background w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              disabled={busy}
              id="social-email"
              maxLength={254}
              name="email"
              required
              type="email"
            />
          </>
        )}
        <button
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          disabled={busy}
          type="submit"
        >
          {hasToken
            ? "Verify email and open library"
            : "Send verification email"}
        </button>
      </form>
      <Link className="underline" href="/">
        Return to sign in or recover an existing account
      </Link>
    </main>
  );
};
