"use client";
import { useApiClient } from "@pr0/api-client/provider";
import { LanguageSetting } from "@pr0/ui/components/language-setting";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "../account-errors";
import { RecoveryForm } from "../recovery-form";

export const ResetPasswordForm = () => {
  const t = useTranslations();

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
      setMessage(t("thePasswordsDoNotMatch"));
      statusRef.current?.focus();
      return;
    }
    if (!token.current) {
      setMessage(t("openTheLinkInYourRecoveryEmailIfItIs"));
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
      setMessage(t("passwordChangedAllPreviousSessionsHaveEndedSignInWith"));
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
      <LanguageSetting />
      <h1 className="text-3xl font-semibold">{t("resetYourPassword")}</h1>
      <p aria-live="polite" ref={statusRef} tabIndex={-1}>
        <LocalizedMessage value={message} />
      </p>
      {complete ? null : (
        <>
          <p>{t("chooseAPasswordWith12128CharactersThisEndsEvery")}</p>
          <form className="space-y-4" onSubmit={submit}>
            <label className="block" htmlFor="password">
              {t("newPassword")}
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
              {t("confirmNewPassword")}
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
              {busy ? t("pleaseWait") : t("resetPassword")}
            </button>
          </form>
          <RecoveryForm />
        </>
      )}
      <Link className="underline" href="/">
        {t("returnToSignIn")}
      </Link>
    </main>
  );
};
