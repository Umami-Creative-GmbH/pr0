"use client";
import { useApiClient } from "@pr0/api-client/provider";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { accountErrorMessage } from "./account-errors";

export const RecoveryForm = () => {
  const t = useTranslations();

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
      setMessage(t("ifThisAddressBelongsToAVerifiedAccountARecovery"));
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
        {t("recoverYourAccount")}
      </h2>
      <p className="mt-2 text-sm">
        {t("useYourVerifiedAccountEmailIncludingIfYouUsuallySign")}
      </p>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <label className="block" htmlFor="recovery-email">
          {t("accountEmail")}
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
        <button className="wf-btn" disabled={busy} type="submit">
          {busy ? t("pleaseWait") : t("sendRecoveryEmail")}
        </button>
      </form>
      <p
        aria-live="polite"
        className="mt-4 text-sm"
        ref={statusRef}
        tabIndex={-1}
      >
        <LocalizedMessage value={message} />
      </p>
    </section>
  );
};
