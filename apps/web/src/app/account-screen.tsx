"use client";
import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { WayfinderShell } from "@pr0/ui/components/wayfinder-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";

import { AccountDeletionSettings } from "./account-deletion-settings";
import { accountErrorMessage, methodResultMessage } from "./account-errors";
import {
  clearDeletedAccountCache,
  deletedPartition,
} from "./deleted-account-cache";
import { EmailSettings } from "./email-settings";
import { LibraryAttentionProvider } from "./library-attention";
import { PromptLibrary } from "./prompt-library";
import { RecoveryForm } from "./recovery-form";
import { SessionSettings } from "./session-settings";
import { SignOutControl } from "./sign-out-control";
import { SocialSignIn } from "./social-sign-in";
import { useQuickAccess } from "./use-quick-access";

const changedLibrary = (
  draft: PrivateLibrary | null,
  current?: PrivateLibrary
) =>
  Boolean(
    draft &&
    current &&
    (draft.account.id !== current.account.id ||
      draft.instance.id !== current.instance.id)
  );
const copyAccountAvailable = (
  library: { data?: PrivateLibrary; isError: boolean },
  accountChanged: boolean
) => Boolean(library.data) && !library.isError && !accountChanged;
const accountStatus = (
  error: string,
  message: string,
  signedIn?: PrivateLibrary,
  methodResult?: string
) => error || message || (!signedIn && methodResultMessage(methodResult));
const initialError = (verification?: string, socialError?: string) => {
  if (socialError === "rate_limited") {
    return "Too many account creation attempts. Wait up to one hour before trying again. Existing accounts can still sign in.";
  }
  if (socialError) {
    return accountErrorMessage(new ApiError(400, socialError));
  }
  return verification === "invalid"
    ? "This verification link is invalid or expired. Request another email below."
    : "";
};

const AccountHeading = ({ signedIn }: { signedIn: boolean }) => (
  <header className={signedIn ? "sr-only" : "wf-auth"}>
    <p className="text-muted-foreground text-sm font-semibold">
      pr0 · Personal prompt library
    </p>
    <h1 className="mt-2 text-3xl font-semibold">
      {signedIn ? "Your library" : "Welcome to pr0"}
    </h1>
  </header>
);

const quickAvailable = (
  signedIn: PrivateLibrary | undefined,
  draftOpen: boolean
) => Boolean(signedIn) && !draftOpen;
const QuickAccessButton = ({
  signedIn,
  disabled,
  onOpen,
}: {
  signedIn?: PrivateLibrary;
  disabled: boolean;
  onOpen: () => void;
}) =>
  signedIn ? (
    <button
      className="wf-omnibar"
      type="button"
      disabled={disabled}
      onClick={onOpen}
    >
      Quick access — find and copy a prompt <kbd>Ctrl K</kbd>
    </button>
  ) : null;
const AccountSettings = ({
  library,
  draftOpen,
  busy,
  onSignOut,
  methodResult,
}: {
  library: PrivateLibrary;
  draftOpen: boolean;
  busy: boolean;
  onSignOut: () => void;
  methodResult?: string;
}) => (
  <details className="wf-settings">
    <summary>Account settings</summary>
    <section aria-labelledby="account-title" className="rounded-lg border p-6">
      <h2 className="font-semibold" id="account-title">
        Account and instance
      </h2>
      <dl className="mt-3 space-y-2 text-sm break-all">
        <dt className="font-medium">Account</dt>
        <dd>{library.account.email}</dd>
        <dt className="font-medium">Instance</dt>
        <dd>{library.instance.origin}</dd>
        <dt className="font-medium">Instance identity</dt>
        <dd>{library.instance.id}</dd>
      </dl>
      <p className="text-muted-foreground mt-4 text-sm">
        {draftOpen ? "Unsaved changes in this tab." : "No open draft."}
      </p>
      <SignOutControl busy={busy} dirty={draftOpen} onSignOut={onSignOut} />
    </section>
    <SessionSettings accountId={library.account.id} />
    <EmailSettings
      key={library.account.id}
      accountId={library.account.id}
      methodResult={methodResult}
    />
  </details>
);

const AccountSignIn = ({
  mode,
  busy,
  pending,
  formRef,
  onSubmit,
  onResend,
  onToggle,
}: {
  mode: "login" | "register";
  busy: boolean;
  pending: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  onToggle: () => void;
}) => {
  const submitLabel = mode === "login" ? "Sign in" : "Create account";
  return (
    <section aria-labelledby="form-title" className="wf-auth">
      <h2 className="text-xl font-medium" id="form-title">
        {mode === "login" ? "Sign in" : "Create an account"}
      </h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Verify your email before accessing your library. Registration depends on
        this instance’s admission settings.
      </p>
      <SocialSignIn />
      <form className="mt-6 space-y-4" onSubmit={onSubmit} ref={formRef}>
        <div className="space-y-2">
          <label className="block font-medium" htmlFor="email">
            Email
          </label>
          <input
            autoComplete="email"
            className="bg-background w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
            disabled={busy}
            id="email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </div>
        <div className="space-y-2">
          <label className="block font-medium" htmlFor="password">
            Password
          </label>
          <input
            aria-describedby="password-help"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            className="bg-background w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
            disabled={busy}
            id="password"
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
          />
          <p className="text-muted-foreground text-sm" id="password-help">
            Use 12–128 characters.
          </p>
        </div>
        <button
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          disabled={busy || pending}
          type="submit"
        >
          {busy ? "Please wait…" : submitLabel}
        </button>
        <button
          className="block text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2"
          disabled={busy}
          onClick={onResend}
          type="button"
        >
          Send another verification email
        </button>
      </form>
      <button
        className="mt-6 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2"
        disabled={busy}
        onClick={onToggle}
        type="button"
      >
        {mode === "login"
          ? "Create a new account"
          : "Already registered? Sign in"}
      </button>
    </section>
  );
};

const LibraryLoadError = ({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}) => {
  if (!error || (error instanceof ApiError && error.status === 401)) {
    return null;
  }
  return (
    <p role="alert">
      Unable to open your library.{" "}
      <button className="underline" type="button" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
};

export const AccountScreen = ({
  verification,
  socialError,
  methodResult,
}: {
  verification?: string;
  socialError?: string;
  methodResult?: string;
}) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [draftLibrary, setDraftLibrary] = useState<PrivateLibrary | null>(null);
  const draftOpen = Boolean(draftLibrary);
  const [message, setMessage] = useState(
    verification === "ok" ? "Email verified. Sign in to open your library." : ""
  );
  const [errorText, setErrorText] = useState(() =>
    initialError(verification, socialError)
  );
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const library = useQuery({
    queryKey: ["account-library", client.baseUrl],
    queryFn: ({ signal }) => client.getLibrary(signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setErrorText("");
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setErrorText(
        accountErrorMessage(
          error instanceof Error ? error : new Error("Request failed")
        )
      );
    }
    setBusy(false);
    statusRef.current?.focus();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const credentials = {
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    };
    void run(async () => {
      if (mode === "register") {
        await client.register(credentials);
        form.reset();
        setMessage(
          "If this address can register, a verification email has been queued. Check your inbox and spam folder, then sign in. If it does not arrive, request another email."
        );
      } else {
        await queryClient.cancelQueries();
        queryClient.clear();
        await client.signIn(credentials);
        form.reset();
        const result = await library.refetch();
        if (result.error) {
          throw result.error;
        }
        setMessage("Signed in. Your library is ready.");
      }
    });
  };

  const resend = () => {
    const input = formRef.current?.elements.namedItem("email");
    if (!(input instanceof HTMLInputElement) || !input.reportValidity()) {
      return;
    }
    void run(async () => {
      await client.resendVerification(input.value);
      setMessage(
        "If this address needs verification, an email has been queued. Check your inbox and spam folder. Delivery may take a few minutes."
      );
    });
  };

  const logout = () => {
    void run(async () => {
      await queryClient.cancelQueries();
      await client.signOut();
      setDraftLibrary(null);
      queryClient.clear();
      await library.refetch();
      setMessage("Signed out.");
    });
  };

  const signedIn = draftLibrary ?? library.data;
  const retainDraft = (dirty: boolean) => {
    setDraftLibrary((current) =>
      dirty ? (current ?? library.data ?? null) : null
    );
  };
  const accountChanged = changedLibrary(draftLibrary, library.data);
  const quick = useQuickAccess(quickAvailable(signedIn, draftOpen));
  return (
    <WayfinderShell
      surface="web"
      identity={signedIn?.account.email}
      actions={
        <QuickAccessButton
          signedIn={signedIn}
          disabled={draftOpen}
          onOpen={() => quick.show()}
        />
      }
    >
      <main>
        <AccountHeading signedIn={Boolean(signedIn)} />
        <p
          aria-live="polite"
          className="wf-status"
          ref={statusRef}
          tabIndex={-1}
        >
          {accountStatus(errorText, message, signedIn, methodResult)}
        </p>
        {library.isPending ? <output>Checking your session…</output> : null}

        {signedIn ? (
          <>
            <LibraryAttentionProvider
              key={`${signedIn.instance.id}:${signedIn.account.id}`}
            >
              <PromptLibrary
                quickOpen={quick.open}
                onQuickClose={() => quick.close()}
                accountChanged={accountChanged}
                accountAvailable={copyAccountAvailable(library, accountChanged)}
                key={`${signedIn.instance.id}:${signedIn.account.id}`}
                library={signedIn}
                onDirtyChange={retainDraft}
              />
            </LibraryAttentionProvider>
            {accountChanged ? (
              <p role="alert">
                Your browser is now signed in to a different account. This draft
                belongs to {signedIn.account.email}. Return to that account to
                save, or copy your text before discarding the draft.
              </p>
            ) : (
              <AccountSettings
                library={signedIn}
                draftOpen={draftOpen}
                busy={busy}
                onSignOut={logout}
                methodResult={methodResult}
              />
            )}
          </>
        ) : (
          <AccountSignIn
            mode={mode}
            busy={busy}
            pending={library.isPending}
            formRef={formRef}
            onSubmit={submit}
            onResend={resend}
            onToggle={() => {
              setMode(mode === "login" ? "register" : "login");
              setErrorText("");
            }}
          />
        )}
        {!signedIn && !library.isPending ? <RecoveryForm /> : null}
        <LibraryLoadError
          error={library.error}
          onRetry={() => {
            void library.refetch();
          }}
        />
        <details className="wf-settings" open={!signedIn}>
          <summary>Account deletion and recovery</summary>{" "}
          <AccountDeletionSettings
            accountId={signedIn?.account.id}
            onDeleted={async (identity) => {
              setDraftLibrary((current) =>
                deletedPartition(current, identity) ? null : current
              );
              if (
                await clearDeletedAccountCache(
                  queryClient,
                  client.baseUrl,
                  identity
                )
              ) {
                await library.refetch();
              }
            }}
          />
        </details>
      </main>
    </WayfinderShell>
  );
};
