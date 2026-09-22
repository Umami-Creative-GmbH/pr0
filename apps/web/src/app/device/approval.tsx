"use client";
import { useApiClient } from "@pr0/api-client/provider";
import { LanguageSetting } from "@pr0/ui/components/language-setting";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "../account-errors";

export const DeviceApproval = ({ initialCode }: { initialCode: string }) => {
  const t = useTranslations();

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
        t("valueReturnToTheDesktopAndStartANewApproval", [
          accountErrorMessage(
            error instanceof Error ? error : new Error("Approval failed")
          ),
        ])
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
          ? t("desktopApprovedReturnToPr0OnYourComputer")
          : t("desktopDeniedNoDesktopSignInWasCreated")
      );
    });
  };
  return (
    <main className="mx-auto max-w-lg space-y-6 p-8">
      <LanguageSetting />
      <h1 className="text-2xl font-semibold">{t("approveYourDesktop")}</h1>
      <p>{t("onlyApproveACodeShownByPr0OnAComputer")}</p>
      {!account.data && !finished ? (
        <form className="space-y-4" onSubmit={login}>
          <label className="block">
            {t("email")}
            <input
              autoComplete="username"
              className="block w-full rounded border p-2"
              name="email"
              required
              type="email"
            />
          </label>
          <label className="block">
            {t("password")}
            <input
              autoComplete="current-password"
              className="block w-full rounded border p-2"
              name="password"
              required
              type="password"
            />
          </label>
          <button className="wf-btn" disabled={busy} type="submit">
            {t("signIn")}
          </button>
          <p>
            <a className="underline" href="/" rel="noopener" target="_blank">
              {t("registerRecoverAccessOrUseAnotherSignInMethod")}
            </a>
            {t("thenReturnToThisTab")}
          </p>
          <button
            className="wf-btn"
            disabled={busy}
            onClick={() => {
              void account.refetch();
            }}
            type="button"
          >
            {t("checkSignIn")}
          </button>
        </form>
      ) : null}
      {account.data && !finished ? (
        <section className="space-y-4">
          <p>
            {t("account2")} <strong>{account.data.account.email}</strong>
          </p>
          <p>
            {t("server")} {account.data.instance.origin}
          </p>
          <label className="block">
            {t("matchingDesktopCode")}
            <input
              className="block w-full rounded border p-2 font-mono text-xl"
              maxLength={8}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              value={code}
            />
          </label>
          <p>{t("checkThatThisCodeMatchesTheOneOnYourDesktop")}</p>
          <div className="flex gap-3">
            <button
              className="wf-btn"
              disabled={busy || !/^[A-Z2-9]{8}$/u.test(code)}
              onClick={() => decide(true)}
              type="button"
            >
              {t("approveMatchingCode")}
            </button>
            <button
              className="wf-btn"
              disabled={busy}
              onClick={() => decide(false)}
              type="button"
            >
              {t("deny")}
            </button>
          </div>
          <a className="underline" href="/" rel="noopener" target="_blank">
            {t("manageOrChangeTheBrowserAccount")}
          </a>
        </section>
      ) : null}
      <p aria-live="polite" ref={status} tabIndex={-1}>
        <LocalizedMessage value={message} />
      </p>
    </main>
  );
};
