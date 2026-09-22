"use client";
import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import type { AccountIdentity } from "@pr0/api-contract/accounts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { accountErrorMessage, methodResultMessage } from "./account-errors";

const labels = {
  credential: "emailAndPassword" as const,
  google: "google" as const,
  github: "github" as const,
};
const buttonClass = "wf-btn";
const focusConfirmation = (button: HTMLButtonElement | null) => button?.focus();
export const LoginMethodSettings = ({
  identity,
  fresh,
  result,
  refreshAccount,
}: {
  identity: AccountIdentity;
  fresh: boolean;
  result?: string;
  refreshAccount: () => Promise<void>;
}) => {
  const t = useTranslations();

  const client = useApiClient();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState(() => methodResultMessage(result));
  const statusRef = useRef<HTMLParagraphElement>(null);
  const methods = useQuery({
    queryKey: ["login-methods", client.baseUrl, identity.accountId],
    queryFn: async ({ signal }) => {
      const response = await client.getLoginMethods(signal);
      if (response.accountId !== identity.accountId) {
        throw new ApiError(409, "account_changed");
      }
      return response;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setMessage(
        accountErrorMessage(
          error instanceof Error
            ? error
            : new Error("Login method change failed")
        )
      );
    }
    await Promise.all([methods.refetch(), refreshAccount()]);
    setRemoving(null);
    setBusy(false);
    statusRef.current?.focus();
  };
  return (
    <section
      aria-labelledby="login-methods-title"
      className="mt-6 border-t pt-6"
    >
      <h3 className="text-lg font-medium" id="login-methods-title">
        {t("loginMethods")}
      </h3>
      <p className="mt-2 text-sm">
        {t("linkGoogleOrGithubToThisLibraryTheProviderMay")}
      </p>
      {fresh ? null : (
        <p className="mt-2 text-sm">
          {t("confirmYourIdentityAboveToLinkOrRemoveAMethod")}
        </p>
      )}
      <p
        aria-live="polite"
        className="my-3 text-sm"
        ref={statusRef}
        tabIndex={-1}
      >
        <LocalizedMessage value={message} />
      </p>
      {methods.isPending ? <output>{t("loadingLoginMethods")}</output> : null}
      {methods.isError ? (
        <p role="alert">
          {accountErrorMessage(methods.error)}{" "}
          <button
            className={buttonClass}
            type="button"
            onClick={() => {
              void methods.refetch();
            }}
          >
            {t("retryLoginMethods")}
          </button>
        </p>
      ) : null}
      {methods.data && !methods.isError ? (
        <fieldset className="space-y-3" disabled={busy || !fresh}>
          <legend className="sr-only">{t("manageLoginMethods")}</legend>
          <ul className="space-y-3">
            {methods.data.methods.map((method) => (
              <li key={method.id} className="space-y-2">
                <p>
                  {t(labels[method.provider])}
                  {method.usable
                    ? t("available")
                    : t("unavailableOnThisInstance")}
                </p>
                {removing === method.id ? (
                  <div className="space-y-2">
                    <p>
                      {t("remove")} {t(labels[method.provider])}
                      {t("youWillNeedAnotherMethodToSignIn")}
                    </p>
                    <button
                      className={buttonClass}
                      ref={focusConfirmation}
                      type="button"
                      onClick={() => {
                        void run(async () => {
                          await client.removeLoginMethod({
                            ...identity,
                            methodId: method.id,
                          });
                          setMessage(
                            t("valueRemovedYourLibraryIsUnchanged", [
                              t(labels[method.provider]),
                            ])
                          );
                        });
                      }}
                    >
                      {t("confirmRemovalOf")} {t(labels[method.provider])}
                    </button>{" "}
                    <button
                      className={buttonClass}
                      type="button"
                      onClick={() => {
                        setRemoving(null);
                        setMessage(
                          t("removalCancelledYourLoginMethodsAreUnchanged")
                        );
                        statusRef.current?.focus();
                      }}
                    >
                      {t("cancelRemoval")}
                    </button>
                  </div>
                ) : (
                  <button
                    className={buttonClass}
                    type="button"
                    onClick={() => setRemoving(method.id)}
                  >
                    {t("remove")} {t(labels[method.provider])}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {methods.data.providers.map((provider) =>
              methods.data.methods.some(
                (method) => method.provider === provider
              ) ? null : (
                <button
                  key={provider}
                  className={buttonClass}
                  type="button"
                  onClick={() => {
                    void run(async () => {
                      const redirect = await client.linkLoginMethod({
                        ...identity,
                        provider,
                      });
                      window.location.assign(redirect.url);
                    });
                  }}
                >
                  {t("link")} {t(labels[provider])}
                </button>
              )
            )}
          </div>
          {busy ? <output>{t("working")}</output> : null}
        </fieldset>
      ) : null}
    </section>
  );
};
