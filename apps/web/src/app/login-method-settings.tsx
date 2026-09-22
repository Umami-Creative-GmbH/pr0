"use client";

import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import type { AccountIdentity } from "@pr0/api-contract/accounts";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { accountErrorMessage, methodResultMessage } from "./account-errors";

const labels = {
  credential: "Email and password",
  google: "Google",
  github: "GitHub",
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
        Login methods
      </h3>
      <p className="mt-2 text-sm">
        Link Google or GitHub to this library. The provider may use a different
        email; your account email stays the same. Keep at least one usable login
        method.
      </p>
      {fresh ? null : (
        <p className="mt-2 text-sm">
          Confirm your identity above to link or remove a method.
        </p>
      )}
      <p
        aria-live="polite"
        className="my-3 text-sm"
        ref={statusRef}
        tabIndex={-1}
      >
        {message}
      </p>
      {methods.isPending ? <output>Loading login methods…</output> : null}
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
            Retry login methods
          </button>
        </p>
      ) : null}
      {methods.data && !methods.isError ? (
        <fieldset className="space-y-3" disabled={busy || !fresh}>
          <legend className="sr-only">Manage login methods</legend>
          <ul className="space-y-3">
            {methods.data.methods.map((method) => (
              <li key={method.id} className="space-y-2">
                <p>
                  {labels[method.provider]}
                  {method.usable
                    ? " · Available"
                    : " · Unavailable on this instance"}
                </p>
                {removing === method.id ? (
                  <div className="space-y-2">
                    <p>
                      Remove {labels[method.provider]}? You will need another
                      method to sign in.
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
                            `${labels[method.provider]} removed. Your library is unchanged.`
                          );
                        });
                      }}
                    >
                      Confirm removal of {labels[method.provider]}
                    </button>{" "}
                    <button
                      className={buttonClass}
                      type="button"
                      onClick={() => {
                        setRemoving(null);
                        setMessage(
                          "Removal cancelled. Your login methods are unchanged."
                        );
                        statusRef.current?.focus();
                      }}
                    >
                      Cancel removal
                    </button>
                  </div>
                ) : (
                  <button
                    className={buttonClass}
                    type="button"
                    onClick={() => setRemoving(method.id)}
                  >
                    Remove {labels[method.provider]}
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
                  Link {labels[provider]}
                </button>
              )
            )}
          </div>
          {busy ? <output>Working…</output> : null}
        </fieldset>
      ) : null}
    </section>
  );
};
