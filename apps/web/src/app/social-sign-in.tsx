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
    <div className="mt-4 space-y-3">
      {providers.data?.providers.map((provider) => (
        <button
          className="mr-3 rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
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
          className="underline"
          onClick={() => {
            void providers.refetch();
          }}
          type="button"
        >
          Retry loading sign-in methods
        </button>
      ) : null}
      <p aria-live="polite" ref={status} tabIndex={-1}>
        {errorText}
      </p>
    </div>
  );
};
