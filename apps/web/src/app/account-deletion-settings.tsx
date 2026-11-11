"use client";
import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import type { DeletionIdentity } from "@pr0/api-contract/deletions";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useRef, useState } from "react";

import { accountErrorMessage } from "./account-errors";
import { useDeletionRecovery } from "./use-deletion-recovery";

const buttonClass = "wf-btn";

type DeletionView = "deleted" | "pending" | "confirm" | "start";

const deletionView = (
  deleted: boolean,
  pending: boolean,
  hasIdentity: boolean
): DeletionView => {
  if (deleted) {
    return "deleted";
  }
  if (pending) {
    return "pending";
  }
  return hasIdentity ? "confirm" : "start";
};

// A 4xx response means the server refused the request before deleting anything.
const isRefusalStatus = (status: number) => status >= 400 && status < 500;

const ConfirmDeletion = ({
  busy,
  confirmed,
  onConfirmedChange,
  onDelete,
  onCancel,
}: {
  busy: boolean;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  onDelete: () => void;
  onCancel: () => void;
}) => {
  const t = useTranslations();
  return (
    <section aria-labelledby="confirm-deletion-title" className="space-y-3">
      <h3 id="confirm-deletion-title" className="font-semibold">
        {t("confirmAccountDeletion")}
      </h3>
      <p>
        {t(
          "thisPermanentlyRemovesYourAccountPromptsOrganizationSessionsAndUnsaved"
        )}
      </p>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
        />
        {t("iUnderstandThatMyAccountAndEntireLibraryWillBe")}
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !confirmed}
          onClick={onDelete}
        >
          {t("permanentlyDeleteAccountAndLibrary")}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
      </div>
    </section>
  );
};

export const AccountDeletionSettings = ({
  accountId,
  onDeleted,
}: {
  accountId?: string;
  onDeleted: (identity: DeletionIdentity) => Promise<void>;
}) => {
  const t = useTranslations();

  const client = useApiClient();
  const [prepared, setPrepared] = useState<DeletionIdentity | null>(null);
  const recovery = useDeletionRecovery(client.baseUrl);
  const identity = recovery.pending ?? prepared;
  // A persisted identity means a submitted deletion whose outcome is unknown.
  const pending = Boolean(recovery.pending);
  const emailVersion = useRef(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [message, setMessage] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(
        pending
          ? t("theDeletionStatusCouldNotBeCheckedRetry")
          : accountErrorMessage(
              error instanceof Error ? error : new Error("Deletion unavailable")
            )
      );
    }
    setBusy(false);
    status.current?.focus();
  };
  const prepare = () =>
    run(async () => {
      const settings = await client.getAccountSettings();
      if (settings.accountId !== accountId) {
        throw new Error("Account changed");
      }
      if (
        !settings.freshUntil ||
        Date.parse(settings.freshUntil) <= Date.now()
      ) {
        setMessage(t("confirmYourIdentityInAccountSecurityBelowThenReturnTo"));
        return;
      }
      const setup = await client.getDeletionIdentity();
      if (setup.accountId !== accountId) {
        throw new Error("Account changed");
      }
      setPrepared(setup);
      emailVersion.current = settings.emailVersion;
      setConfirmed(false);
      setMessage("");
    });
  const complete = async (pinned: DeletionIdentity) => {
    setDeleted(true);
    setMessage(t("yourAccountAndLibraryHaveBeenDeleted"));
    // Cleanup is bound to the identity kept before submission, never to a later session.
    await onDeleted(pinned);
    recovery.persist(null);
    setPrepared(null);
  };
  const remove = () =>
    run(async () => {
      if (!identity || !confirmed) {
        return;
      }
      // Keep the identity first: a lost response can still be resolved after a reload.
      recovery.persist(identity);
      let deletedAccount: string;
      try {
        const result = await client.deleteAccount({
          accountId: identity.accountId,
          emailVersion: emailVersion.current,
          confirmation: "delete-account",
        });
        deletedAccount = result.accountId;
      } catch (error) {
        if (error instanceof ApiError && isRefusalStatus(error.status)) {
          // Refused before deletion: nothing changed.
          recovery.persist(null);
          setPrepared(null);
          throw error;
        }
        setMessage(t("theDeletionResultWasNotReceivedCheckItsStatus"));
        return;
      }
      if (deletedAccount !== identity.accountId) {
        throw new Error("Account changed");
      }
      await complete(identity);
    });
  const check = () =>
    run(async () => {
      if (!identity) {
        return;
      }
      const result = await client.getDeletionStatus(identity.handle);
      if (
        result.status === "deleted" &&
        result.accountId === identity.accountId
      ) {
        await complete(identity);
      } else {
        recovery.persist(null);
        setPrepared(null);
        setMessage(t("noDeletionWasRecordedYourAccountWasNotDeleted"));
      }
    });
  if (!accountId && !pending && !deleted) {
    return null;
  }
  const view = deletionView(deleted, pending, Boolean(identity));
  return (
    <section
      aria-labelledby="delete-account-title"
      className="space-y-3 rounded-lg border p-6"
    >
      <h2 id="delete-account-title" className="font-semibold">
        {t("deleteAccount")}
      </h2>
      <p ref={status} aria-live="polite" tabIndex={-1}>
        {message ||
          (pending ? t("theDeletionResultWasNotReceivedCheckItsStatus") : "")}
      </p>
      {view === "deleted" ? (
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            setDeleted(false);
            setMessage("");
          }}
        >
          {t("finish")}
        </button>
      ) : null}
      {view === "pending" ? (
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            void check();
          }}
        >
          {t("checkDeletionStatus")}
        </button>
      ) : null}
      {view === "start" ? (
        <button
          ref={opener}
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            void prepare();
          }}
        >
          {t("deleteAccount")}
        </button>
      ) : null}
      {view === "confirm" ? (
        <ConfirmDeletion
          busy={busy}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
          onDelete={() => {
            void remove();
          }}
          onCancel={() => {
            setPrepared(null);
            setConfirmed(false);
            requestAnimationFrame(() => opener.current?.focus());
          }}
        />
      ) : null}
    </section>
  );
};
