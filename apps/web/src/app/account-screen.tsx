"use client";
import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { AuthLayout } from "@pr0/ui/components/auth-layout";
import { WayfinderShell } from "@pr0/ui/components/wayfinder-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { useRef, useState } from "react";
import type { ComponentProps, FormEvent, RefObject } from "react";

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

const quickAvailable = (
  signedIn: PrivateLibrary | undefined,
  blocked: boolean
) => Boolean(signedIn) && !blocked;
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
      <Search aria-hidden="true" size={15} />
      <span>Quick access — find and copy a prompt</span>
      <kbd className="wf-kbd">Ctrl K</kbd>
    </button>
  ) : null;
const AccountSettings = ({
  library,
  draftOpen,
  methodResult,
}: {
  library: PrivateLibrary;
  draftOpen: boolean;
  methodResult?: string;
}) => (
  <>
    <section aria-labelledby="account-title" className="wf-card">
      <h2 id="account-title">Account and instance</h2>
      <dl className="grid gap-1 text-sm break-all">
        <dt className="wf-eyebrow">Account</dt>
        <dd>{library.account.email}</dd>
        <dt className="wf-eyebrow mt-2">Instance</dt>
        <dd>{library.instance.origin}</dd>
        <dt className="wf-eyebrow mt-2">Instance identity</dt>
        <dd className="wf-mono">{library.instance.id}</dd>
      </dl>
      <p className="wf-hint">
        {draftOpen ? "Unsaved changes in this tab." : "No open draft."}
      </p>
    </section>
    <SessionSettings accountId={library.account.id} />
    <EmailSettings
      key={library.account.id}
      accountId={library.account.id}
      methodResult={methodResult}
    />
  </>
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
    <section aria-labelledby="form-title" className="contents">
      <header className="flex flex-col gap-2">
        <span className="wf-eyebrow-accent">
          {mode === "login" ? "Welcome to pr0" : "One account, every device"}
        </span>
        <h2 id="form-title">
          {mode === "login" ? "Sign in" : "Create an account"}
        </h2>
        <p className="wf-hint">
          Verify your email before accessing your library. Registration depends
          on this instance’s admission settings.
        </p>
      </header>
      <form onSubmit={onSubmit} ref={formRef}>
        <div className="wf-field">
          <label className="wf-label" htmlFor="email">
            Email
          </label>
          <input
            autoComplete="email"
            disabled={busy}
            id="email"
            maxLength={254}
            name="email"
            placeholder="name@company.com"
            required
            type="email"
          />
        </div>
        <div className="wf-field">
          <label className="wf-label" htmlFor="password">
            Password
          </label>
          <input
            aria-describedby="password-help"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            disabled={busy}
            id="password"
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
          />
          <p className="wf-hint" id="password-help">
            Use 12–128 characters.
          </p>
        </div>
        <button
          className="wf-btn-accent wf-btn-block"
          disabled={busy || pending}
          type="submit"
        >
          {busy ? "Please wait…" : submitLabel}
          <ArrowRight aria-hidden="true" size={15} />
        </button>
        <button
          className="wf-link self-start"
          disabled={busy}
          onClick={onResend}
          type="button"
        >
          Send another verification email
        </button>
      </form>
      <SocialSignIn />
      <button
        className="wf-link self-start"
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
    <p className="wf-notice" role="alert">
      Unable to open your library.{" "}
      <button className="wf-link" type="button" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
};

/** Settings when signed in; recovery and deletion help when signed out. */
const AccountPage = ({
  signedIn,
  showSettings,
  accountChanged,
  draftOpen,
  methodResult,
  pending,
  error,
  onBack,
  onRetry,
  onDeleted,
}: {
  signedIn?: PrivateLibrary;
  showSettings: boolean;
  accountChanged: boolean;
  draftOpen: boolean;
  methodResult?: string;
  pending: boolean;
  error: Error | null;
  onBack: () => void;
  onRetry: () => void;
  onDeleted: ComponentProps<typeof AccountDeletionSettings>["onDeleted"];
}) => (
  <div className="wf-page" hidden={Boolean(signedIn) && !showSettings}>
    {showSettings ? (
      <div className="flex items-center justify-between gap-3">
        <h2>Account settings</h2>
        <button className="wf-btn" type="button" onClick={onBack}>
          Back to library
        </button>
      </div>
    ) : null}
    {signedIn && !accountChanged ? (
      <AccountSettings
        library={signedIn}
        draftOpen={draftOpen}
        methodResult={methodResult}
      />
    ) : null}
    {!signedIn && !pending ? <RecoveryForm /> : null}
    <LibraryLoadError error={error} onRetry={onRetry} />
    <details className="wf-card" open={!signedIn}>
      <summary>Account deletion and recovery</summary>{" "}
      <AccountDeletionSettings
        accountId={signedIn?.account.id}
        onDeleted={onDeleted}
      />
    </details>
  </div>
);

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
  const [settingsOpen, setSettingsOpen] = useState(Boolean(methodResult));
  const showSettings = Boolean(signedIn) && settingsOpen;
  const quick = useQuickAccess(
    quickAvailable(signedIn, draftOpen || showSettings)
  );
  return (
    <WayfinderShell
      surface="web"
      identity={signedIn?.account.email}
      actions={
        <QuickAccessButton
          signedIn={signedIn}
          disabled={draftOpen || showSettings}
          onOpen={() => quick.show()}
        />
      }
      menu={
        signedIn && !accountChanged ? (
          <>
            <button
              className="wf-menu-item"
              type="button"
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              {settingsOpen ? "Back to library" : "Account settings"}
            </button>
            <SignOutControl busy={busy} dirty={draftOpen} onSignOut={logout} />
          </>
        ) : null
      }
    >
      <main className="wf-main">
        <h1 className="sr-only">
          {signedIn ? "Your library" : "Welcome to pr0"}
        </h1>
        <p
          aria-live="polite"
          className="wf-banner"
          ref={statusRef}
          tabIndex={-1}
        >
          {accountStatus(errorText, message, signedIn, methodResult)}
        </p>
        {library.isPending ? (
          <output className="wf-empty">Checking your session…</output>
        ) : null}
        {signedIn && accountChanged ? (
          <p className="wf-banner" role="alert">
            Your browser is now signed in to a different account. This draft
            belongs to {signedIn.account.email}. Return to that account to save,
            or copy your text before discarding the draft.
          </p>
        ) : null}
        {signedIn ? (
          <div className="contents" hidden={showSettings}>
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
          </div>
        ) : null}
        {signedIn || library.isPending ? null : (
          <AuthLayout keys="Ctrl K ⦁ Search ⦁ ↵ ⦁ Copied">
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
          </AuthLayout>
        )}
        <AccountPage
          signedIn={signedIn}
          showSettings={showSettings}
          accountChanged={accountChanged}
          draftOpen={draftOpen}
          methodResult={methodResult}
          pending={library.isPending}
          error={library.error}
          onBack={() => setSettingsOpen(false)}
          onRetry={() => {
            void library.refetch();
          }}
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
      </main>
    </WayfinderShell>
  );
};
