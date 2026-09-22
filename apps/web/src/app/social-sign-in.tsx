"use client";

import { useApiClient } from "@pr0/api-client/provider";
import type { SocialProvider } from "@pr0/api-contract/accounts";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { accountErrorMessage } from "./account-errors";

export const SocialSignIn = () => {
  const client = useApiClient();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const status = useRef<HTMLParagraphElement>(null);
  const providers = useQuery({
    queryKey: ["social-providers", client.baseUrl],
    queryFn: ({ signal }) => client.getSocialProviders(signal),
    retry: false,
  });
  const signIn = async (provider: SocialProvider) => {
    setBusy(true);
    setErrorText("");
    try {
      const { url } = await client.signInSocial(provider);
      window.location.assign(url);
    } catch (error) {
      setErrorText(
        accountErrorMessage(
          error instanceof Error ? error : new Error("Sign in failed")
        )
      );
      setBusy(false);
      status.current?.focus();
    }
  };
  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {providers.data?.providers.length ? (
        <p className="wf-divider">or</p>
      ) : null}
      {providers.data?.providers.map((provider) => (
        <button
          className="wf-btn wf-btn-block"
          disabled={busy}
          key={provider}
          onClick={() => {
            void signIn(provider);
          }}
          type="button"
        >
          Continue with {provider === "google" ? "Google" : "GitHub"}
        </button>
      ))}
      {providers.isError ? (
        <button
          className="wf-link self-start"
          onClick={() => {
            void providers.refetch();
          }}
          type="button"
        >
          Retry loading sign-in methods
        </button>
      ) : null}
      <p
        aria-live="polite"
        className="wf-error empty:hidden"
        ref={status}
        tabIndex={-1}
      >
        {errorText}
      </p>
    </div>
  );
};
