"use client";

import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "./account-errors";
import { EmailSettings } from "./email-settings";
import { RecoveryForm } from "./recovery-form";
import { SessionSettings } from "./session-settings";
import { SocialSignIn } from "./social-sign-in";

export const AccountScreen = ({
  verification,
  socialError,
}: {
  verification?: string;
  socialError?: string;
}) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    verification === "ok" ? "Email verified. Sign in to open your library." : ""
  );
  const [errorText, setErrorText] = useState(() => {
    if (socialError === "rate_limited") {
      return "Too many account creation attempts. Wait up to one hour before trying again. Existing accounts can still sign in.";
    }
    if (socialError) {
      return accountErrorMessage(new ApiError(400, socialError));
    }
    return verification === "invalid"
      ? "This verification link is invalid or expired. Request another email below."
      : "";
  });
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const library = useQuery({
    queryKey: ["account-library", client.baseUrl],
    queryFn: ({ signal }) => client.getLibrary(signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setErrorText("");
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setErrorText(
        accountErrorMessage(
          error instanceof Error ? error : new Error("Request failed")
        )
      );
    }
    setBusy(false);
    statusRef.current?.focus();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const credentials = {
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    };
    void run(async () => {
      if (mode === "register") {
        await client.register(credentials);
        form.reset();
        setMessage(
          "If this address can register, a verification email has been queued. Check your inbox and spam folder, then sign in. If it does not arrive, request another email."
        );
      } else {
        await queryClient.cancelQueries();
        queryClient.clear();
        await client.signIn(credentials);
        form.reset();
        const result = await library.refetch();
        if (result.error) {
          throw result.error;
        }
        setMessage("Signed in. Your library is ready.");
      }
    });
  };

  const resend = () => {
    const input = formRef.current?.elements.namedItem("email");
    if (!(input instanceof HTMLInputElement) || !input.reportValidity()) {
      return;
    }
    void run(async () => {
      await client.resendVerification(input.value);
      setMessage(
        "If this address needs verification, an email has been queued. Check your inbox and spam folder. Delivery may take a few minutes."
      );
    });
  };

  const logout = () => {
    void run(async () => {
      await queryClient.cancelQueries();
      await client.signOut();
      queryClient.clear();
      await library.refetch();
      setMessage("Signed out.");
    });
  };

  const signedIn = library.data && !library.isError;
  const submitLabel = mode === "login" ? "Sign in" : "Create account";
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header>
        <p className="text-muted-foreground text-sm font-semibold">
          pr0 · Personal prompt library
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          {signedIn ? "Your library" : "Welcome to pr0"}
        </h1>
      </header>
      <p aria-live="polite" className="text-sm" ref={statusRef} tabIndex={-1}>
        {errorText || message}
      </p>
      {library.isPending ? <output>Checking your session…</output> : null}
      {signedIn ? (
        <>
          <section
            aria-labelledby="account-title"
            className="rounded-lg border p-6"
          >
            <h2 className="font-semibold" id="account-title">
              Account and instance
            </h2>
            <dl className="mt-3 space-y-2 text-sm break-all">
              <dt className="font-medium">Account</dt>
              <dd>{library.data.account.email}</dd>
              <dt className="font-medium">Instance</dt>
              <dd>{library.data.instance.origin}</dd>
              <dt className="font-medium">Instance identity</dt>
              <dd>{library.data.instance.id}</dd>
            </dl>
            <p className="text-muted-foreground mt-4 text-sm">
              No pending work.
            </p>
            <button
              className="mt-3 rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              disabled={busy}
              onClick={logout}
              type="button"
            >
              Sign out
            </button>
          </section>
          <SessionSettings accountId={library.data.account.id} />
          <EmailSettings
            key={library.data.account.id}
            accountId={library.data.account.id}
          />
          <section
            aria-labelledby="empty-title"
            className="rounded-lg border p-6"
          >
            <h2 className="text-xl font-medium" id="empty-title">
              Your library is empty
            </h2>
            <p className="text-muted-foreground mt-2">
              You are signed in to your private library.
            </p>
          </section>
        </>
      ) : (
        <section aria-labelledby="form-title" className="rounded-lg border p-6">
          <h2 className="text-xl font-medium" id="form-title">
            {mode === "login" ? "Sign in" : "Create an account"}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Verify your email before accessing your library. Registration
            depends on this instance’s admission settings.
          </p>
          <SocialSignIn />
          <form className="mt-6 space-y-4" onSubmit={submit} ref={formRef}>
            <div className="space-y-2">
              <label className="block font-medium" htmlFor="email">
                Email
              </label>
              <input
                autoComplete="email"
                className="bg-background w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                disabled={busy}
                id="email"
                maxLength={254}
                name="email"
                required
                type="email"
              />
            </div>
            <div className="space-y-2">
              <label className="block font-medium" htmlFor="password">
                Password
              </label>
              <input
                aria-describedby="password-help"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                className="bg-background w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                disabled={busy}
                id="password"
                maxLength={128}
                minLength={12}
                name="password"
                required
                type="password"
              />
              <p className="text-muted-foreground text-sm" id="password-help">
                Use 12–128 characters.
              </p>
            </div>
            <button
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              disabled={busy || library.isPending}
              type="submit"
            >
              {busy ? "Please wait…" : submitLabel}
            </button>
            <button
              className="block text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2"
              disabled={busy}
              onClick={resend}
              type="button"
            >
              Send another verification email
            </button>
          </form>
          <button
            className="mt-6 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2"
            disabled={busy}
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setErrorText("");
            }}
            type="button"
          >
            {mode === "login"
              ? "Create a new account"
              : "Already registered? Sign in"}
          </button>
        </section>
      )}
      {!signedIn && !library.isPending ? <RecoveryForm /> : null}
      {library.isError &&
      !(library.error instanceof ApiError && library.error.status === 401) ? (
        <p role="alert">
          Unable to open your library.{" "}
          <button
            className="underline"
            onClick={() => {
              void library.refetch();
            }}
            type="button"
          >
            Retry
          </button>
        </p>
      ) : null}
    </main>
  );
};
