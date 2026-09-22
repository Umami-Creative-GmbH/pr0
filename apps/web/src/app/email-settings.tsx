"use client";
import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "./account-errors";
import { LoginMethodSettings } from "./login-method-settings";

const inputClass =
  "bg-background w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
const buttonClass = "wf-btn";
const notificationMessages = {
  pending: translate("yourEmailChangedTheNotificationToYourOldAddressIs"),
  sent: translate("yourEmailChangedTheMailServerAcceptedTheNotificationTo"),
  failed: translate("yourEmailChangedButTheNotificationToYourOldAddress"),
};

export const EmailSettings = ({
  accountId,
  methodResult,
}: {
  accountId: string;
  methodResult?: string;
}) => {
  const t = useTranslations();

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
      setMessage(t("aCodeHasBeenQueuedForYourCurrentVerifiedEmail"));
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
          setMessage(t("emailUpdatedNotificationStatusIsShownBelow"));
          await queryClient.invalidateQueries({
            queryKey: ["account-library", client.baseUrl],
          });
        } else {
          await client.reauthenticate(input);
          setMessage(t("identityConfirmedForTenMinutesYouCanChangeYourEmail"));
        }
        setChallenge(null);
      } else if (password) {
        await client.reauthenticate({ ...identity, password });
        setMessage(t("identityConfirmedForTenMinutesYouCanChangeYourEmail"));
      } else {
        const result = await client.requestEmailChange({ ...identity, email });
        setChallenge({
          id: result.challengeId,
          purpose: "email",
          emailVersion: identity.emailVersion,
        });
        setMessage(t("aCodeHasBeenQueuedForTheReplacementAddressYour"));
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
        {t("accountSecurity")}
      </h2>
      <p className="mt-2 text-sm">
        {t("confirmYourIdentityToManageLoginMethodsOrChangeYour")}
      </p>
      <p
        aria-live="polite"
        className="my-3 text-sm"
        ref={statusRef}
        tabIndex={-1}
      >
        <LocalizedMessage value={message} />
      </p>
      {settings.data?.notification ? (
        <output className="my-3 block text-sm">
          {notificationMessages[settings.data.notification]}
        </output>
      ) : null}
      {settings.isPending ? <output>{t("loadingEmailSettings")}</output> : null}
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
            {t("retryEmailSettings")}
          </button>
        </p>
      ) : null}
      {settings.data && !settings.isError ? (
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="sr-only">
              {t("verifyIdentityAndReplacementEmail")}
            </legend>
            {challenge ? (
              <>
                <label className="block font-medium" htmlFor="account-code">
                  {challenge.purpose === "reauth"
                    ? t("currentEmailCode")
                    : t("replacementEmailCode")}
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
                  {t("enterAllEightDigitsInThisBrowserThreeWrongAttempts")}
                </p>
                <button className={buttonClass} type="submit">
                  {challenge.purpose === "reauth"
                    ? t("confirmIdentity")
                    : t("verifyAndChangeEmail")}
                </button>
                <button
                  className={buttonClass}
                  type="button"
                  onClick={() => {
                    setChallenge(null);
                    setMessage(
                      t("enterYourDetailsToRequestAReplacementCodeYourAccount")
                    );
                  }}
                >
                  {t("startAgainOrRequestAnotherCode")}
                </button>
              </>
            ) : null}
            {!challenge && fresh ? (
              <>
                <label
                  className="block font-medium"
                  htmlFor="replacement-email"
                >
                  {t("replacementEmail")}
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
                  {t("sendReplacementVerificationCode")}
                </button>
              </>
            ) : null}
            {!challenge &&
            !fresh &&
            settings.data.reauthentication === "password" ? (
              <>
                <label className="block font-medium" htmlFor="reauth-password">
                  {t("confirmCurrentPassword")}
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
                  {t("confirmIdentity")}
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
                {t("sendIdentityCodeToCurrentEmail")}
              </button>
            ) : null}
            {busy ? <output>{t("working")}</output> : null}
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
