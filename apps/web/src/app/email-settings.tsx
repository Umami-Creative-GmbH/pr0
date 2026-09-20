"use client";

import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "./account-errors";
import { LoginMethodSettings } from "./login-method-settings";

const inputClass =
  "bg-background w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
const notificationMessages = {
  pending:
    "Your email changed. The notification to your old address is queued; delivery is not confirmed.",
  sent: "Your email changed. The mail server accepted the notification to your old address; inbox delivery is not confirmed.",
  failed:
    "Your email changed, but the notification to your old address could not be delivered. Automatic retries have ended. Your new address remains active. Contact your instance operator if you need help.",
};

export const EmailSettings = ({
  accountId,
  methodResult,
}: {
  accountId: string;
  methodResult?: string;
}) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [challenge, setChallenge] = useState<{
    id: string;
    purpose: "reauth" | "email";
    emailVersion: number;
  } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const settings = useQuery({
    queryKey: ["account-settings", client.baseUrl, accountId],
    queryFn: async ({ signal }) => {
      const result = await client.getAccountSettings(signal);
      if (result.accountId !== accountId) {
        throw new ApiError(409, "account_changed");
      }
      return result;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) =>
      query.state.data?.notification === "pending" ? 2000 : 15_000,
  });
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setMessage(
        accountErrorMessage(
          error instanceof Error ? error : new Error("Account change failed")
        )
      );
      if (
        error instanceof ApiError &&
        ["fresh_auth_required", "account_changed", "unauthenticated"].includes(
          error.code ?? ""
        )
      ) {
        setChallenge(null);
      }
    }
    await settings.refetch();
    setBusy(false);
    statusRef.current?.focus();
  };
  const requestCode = () => {
    if (!settings.data) {
      return;
    }
    const { emailVersion } = settings.data;
    void run(async () => {
      const result = await client.requestReauthentication({
        accountId,
        emailVersion,
      });
      setChallenge({ id: result.challengeId, purpose: "reauth", emailVersion });
      setMessage(
        "A code has been queued for your current verified email. It expires in five minutes and allows three wrong attempts. Resending replaces the previous code."
      );
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings.data) {
      return;
    }
    const form = event.currentTarget;
    const values = new FormData(form);
    const identity = {
      accountId,
      emailVersion: challenge?.emailVersion ?? settings.data.emailVersion,
    };
    const password = String(values.get("password") ?? "");
    const code = String(values.get("code") ?? "");
    const email = String(values.get("email") ?? "");
    void run(async () => {
      if (challenge) {
        const input = { ...identity, challengeId: challenge.id, code };
        if (challenge.purpose === "email") {
          await client.verifyEmailChange(input);
          setMessage("Email updated. Notification status is shown below.");
          await queryClient.invalidateQueries({
            queryKey: ["account-library", client.baseUrl],
          });
        } else {
          await client.reauthenticate(input);
          setMessage(
            "Identity confirmed for ten minutes. You can change your email or manage login methods."
          );
        }
        setChallenge(null);
      } else if (password) {
        await client.reauthenticate({ ...identity, password });
        setMessage(
          "Identity confirmed for ten minutes. You can change your email or manage login methods."
        );
      } else {
        const result = await client.requestEmailChange({ ...identity, email });
        setChallenge({
          id: result.challengeId,
          purpose: "email",
          emailVersion: identity.emailVersion,
        });
        setMessage(
          "A code has been queued for the replacement address. Your current email remains active until you verify it. The code expires in five minutes and allows three wrong attempts."
        );
      }
      form.reset();
    });
  };
  const fresh = Boolean(settings.data?.freshUntil);
  return (
    <section
      aria-labelledby="email-settings-title"
      className="rounded-lg border p-6"
    >
      <h2 className="text-xl font-medium" id="email-settings-title">
        Account security
      </h2>
      <p className="mt-2 text-sm">
        Confirm your identity to manage login methods or change your account
        email. A replacement email must be verified before your current address
        changes.
      </p>
      <p
        aria-live="polite"
        className="my-3 text-sm"
        ref={statusRef}
        tabIndex={-1}
      >
        {message}
      </p>
      {settings.data?.notification ? (
        <output className="my-3 block text-sm">
          {notificationMessages[settings.data.notification]}
        </output>
      ) : null}
      {settings.isPending ? <output>Loading email settings…</output> : null}
      {settings.isError ? (
        <p role="alert">
          {accountErrorMessage(settings.error)}{" "}
          <button
            className="underline"
            type="button"
            onClick={() => {
              void settings.refetch();
            }}
          >
            Retry email settings
          </button>
        </p>
      ) : null}
      {settings.data && !settings.isError ? (
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="sr-only">
              Verify identity and replacement email
            </legend>
            {challenge ? (
              <>
                <label className="block font-medium" htmlFor="account-code">
                  {challenge.purpose === "reauth"
                    ? "Current email code"
                    : "Replacement email code"}
                </label>
                <input
                  className={inputClass}
                  id="account-code"
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  minLength={8}
                  maxLength={8}
                  required
                  aria-describedby="account-code-help"
                />
                <p id="account-code-help" className="text-sm">
                  Enter all eight digits in this browser. Three wrong attempts
                  invalidate the code.
                </p>
                <button className={buttonClass} type="submit">
                  {challenge.purpose === "reauth"
                    ? "Confirm identity"
                    : "Verify and change email"}
                </button>
                <button
                  className={buttonClass}
                  type="button"
                  onClick={() => {
                    setChallenge(null);
                    setMessage(
                      "Enter your details to request a replacement code. Your account email has not changed."
                    );
                  }}
                >
                  Start again or request another code
                </button>
              </>
            ) : null}
            {!challenge && fresh ? (
              <>
                <label
                  className="block font-medium"
                  htmlFor="replacement-email"
                >
                  Replacement email
                </label>
                <input
                  className={inputClass}
                  id="replacement-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
                <button className={buttonClass} type="submit">
                  Send replacement verification code
                </button>
              </>
            ) : null}
            {!challenge &&
            !fresh &&
            settings.data.reauthentication === "password" ? (
              <>
                <label className="block font-medium" htmlFor="reauth-password">
                  Confirm current password
                </label>
                <input
                  className={inputClass}
                  id="reauth-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
                <button className={buttonClass} type="submit">
                  Confirm identity
                </button>
              </>
            ) : null}
            {!challenge &&
            !fresh &&
            settings.data.reauthentication === "email" ? (
              <button
                className={buttonClass}
                type="button"
                onClick={requestCode}
              >
                Send identity code to current email
              </button>
            ) : null}
            {busy ? <output>Working…</output> : null}
          </fieldset>
          <LoginMethodSettings
            identity={{ accountId, emailVersion: settings.data.emailVersion }}
            fresh={fresh}
            result={methodResult}
            refreshAccount={async () => {
              await settings.refetch();
            }}
          />
        </form>
      ) : null}
    </section>
  );
};
