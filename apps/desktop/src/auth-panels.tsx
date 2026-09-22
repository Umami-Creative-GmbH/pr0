import type { SignOutRequest } from "@pr0/api-contract/desktop-session";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useState } from "react";
import type { FormEvent } from "react";

import type { Status, AuthRun } from "./use-auth-session";

interface PanelProps {
  busy: boolean;
  status: Status;
  run: AuthRun;
}
export const SignInForm = ({ busy, status, run }: PanelProps) => {
  const t = useTranslations();

  const [origin, setOrigin] = useState(import.meta.env.VITE_API_BASE_URL ?? "");
  const [custom, setCustom] = useState(!import.meta.env.VITE_API_BASE_URL);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run("auth_begin", status.origin ?? origin);
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <span className="wf-eyebrow-accent">{t("desktopSignIn")}</span>
      <h2>
        {status.state === "authentication_required"
          ? t("signInToResume")
          : t("signInToPr0")}
      </h2>
      <p className="wf-hint">
        {t("chooseAServerYouTrustYouWillApproveAMatching")}
      </p>
      {custom || status.origin ? (
        <label className="wf-field">
          <span className="wf-label">{t("httpsServer")}</span>
          <input
            disabled={busy || Boolean(status.origin)}
            onChange={(event) => setOrigin(event.target.value)}
            placeholder={t("httpsYourServerExample")}
            required
            type="url"
            value={status.origin ?? origin}
          />
        </label>
      ) : (
        <>
          <p className="wf-hint">
            {t("server")} {origin}
          </p>
          <button
            className="wf-link self-start"
            onClick={() => setCustom(true)}
            type="button"
          >
            {t("useYourOwnServer")}
          </button>
        </>
      )}
      <button className="wf-btn-accent" disabled={busy} type="submit">
        {t("continueInBrowser")}
      </button>
    </form>
  );
};
export const SignOutControl = ({
  busy,
  status,
  run,
  editing,
  onTransition,
}: PanelProps & {
  editing: boolean;
  onTransition: (active: boolean) => void;
}) => {
  const t = useTranslations();

  const [confirm, setConfirm] = useState(false);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [synchronizing, setSynchronizing] = useState(false);
  const choose = async (choice: SignOutRequest["choice"]) => {
    if (!status.instanceId || !status.accountId) {
      return;
    }
    setSynchronizing(choice === "synchronize");
    const result = await run("auth_sign_out", {
      instanceId: status.instanceId,
      accountId: status.accountId,
      generation: status.generation,
      choice,
      discardConfirmed,
    });
    setSynchronizing(false);
    if (result && (choice === "cancel" || result.state === "signed_out")) {
      setConfirm(false);
      setDiscardConfirmed(false);
      onTransition(false);
    }
  };
  if (status.state === "cleanup_required") {
    return (
      <section className="space-y-3" aria-label={t("accountCleanup")}>
        <p>
          {t("accountCleanupIsIncompleteRetryBeforeSigningIntoAnotherAccount")}
        </p>
        <button
          className="wf-btn"
          type="button"
          disabled={busy}
          onClick={() => {
            void choose("retry_cleanup");
          }}
        >
          {t("retryAccountCleanup")}
        </button>
      </section>
    );
  }
  return (
    <section className="space-y-3" aria-label={t("signOutOrChangeServer")}>
      {confirm ? (
        <>
          <h2 className="text-xl font-semibold">{t("beforeYouSignOut")}</h2>
          <p>{t("thisRemovesThisComputerAposSLibraryAndSignIn")}</p>
          <p>{t("ifYouAreOfflineServerRevocationCannotBeConfirmedRevoke")}</p>
          {synchronizing ? (
            <output>
              {t("synchronizingBeforeSignOutWaitingForServerAcknowledgement")}
            </output>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              className="wf-btn"
              disabled={busy}
              onClick={() => {
                void choose("synchronize");
              }}
              type="button"
            >
              {t("synchronizeFirstAndSignOut")}
            </button>
            <button
              className="wf-btn"
              disabled={busy && !synchronizing}
              onClick={() => {
                void choose("cancel");
              }}
              type="button"
            >
              {t("cancelSignOut")}
            </button>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={discardConfirmed}
              disabled={busy}
              onChange={(event) => setDiscardConfirmed(event.target.checked)}
            />
            {t("iUnderstandThatPendingChangesOnThisDeviceWillBe")}
          </label>
          <button
            className="wf-btn"
            disabled={busy || !discardConfirmed}
            onClick={() => {
              void choose("discard");
            }}
            type="button"
          >
            {t("discardLocalWorkAndSignOut")}
          </button>
        </>
      ) : (
        <>
          <button
            className="wf-btn"
            disabled={busy || editing || status.state === "awaiting_approval"}
            onClick={() => {
              setConfirm(true);
              onTransition(true);
            }}
            type="button"
          >
            {t("signOutOrChangeServer")}
          </button>
          {editing ? (
            <p>{t("saveOrCloseThePromptEditorBeforeSigningOutYour")}</p>
          ) : null}
        </>
      )}
    </section>
  );
};
