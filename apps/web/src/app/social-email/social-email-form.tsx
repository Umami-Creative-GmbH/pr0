"use client";
import { useApiClient } from "@pr0/api-client/provider";
import { LanguageSetting } from "@pr0/ui/components/language-setting";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "../account-errors";

export const SocialEmailForm = () => {
  const t = useTranslations();

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
        setMessage(t("checkYourInboxAndSpamFolderOpenTheVerificationLink"));
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
      <LanguageSetting />
      <h1 className="text-3xl font-semibold">{t("verifyYourAccountEmail")}</h1>
      <p>{t("yourProviderDidNotSupplyAUsableVerifiedEmailVerify")}</p>
      <p aria-live="polite" ref={status} tabIndex={-1}>
        <LocalizedMessage value={message} />
      </p>
      <form className="space-y-4" onSubmit={submit}>
        {hasToken ? null : (
          <>
            <label className="block font-medium" htmlFor="social-email">
              {t("accountEmail")}
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
            ? t("verifyEmailAndOpenLibrary")
            : t("sendVerificationEmail")}
        </button>
      </form>
      <Link className="underline" href="/">
        {t("returnToSignInOrRecoverAnExistingAccount")}
      </Link>
    </main>
  );
};
