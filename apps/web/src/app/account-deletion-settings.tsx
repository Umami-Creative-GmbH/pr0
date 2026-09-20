"use client";

import { ApiError } from "@pr0/api-client/client";
import { verifyDeletionReceipt } from "@pr0/api-client/deletions";
import { useApiClient } from "@pr0/api-client/provider";
import type { DeletionTrust } from "@pr0/api-contract/deletions";
import { useRef, useState } from "react";

import { accountErrorMessage } from "./account-errors";
import { useDeletionRecovery } from "./use-deletion-recovery";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
export const AccountDeletionSettings = ({
  accountId,
  onDeleted,
}: {
  accountId?: string;
  onDeleted: (identity: DeletionTrust) => Promise<void>;
}) => {
  const client = useApiClient();
  const [prepared, setPrepared] = useState<DeletionTrust | null>(null);
  const recovery = useDeletionRecovery(client.baseUrl);
  const trust = recovery.pending ?? prepared;
  const pending = Boolean(recovery.pending);
  const emailVersion = useRef(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState("");
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
          ? "Deletion is still pending. Completion could not be verified. Retry checking its status."
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
        setMessage(
          "Confirm your identity in Account security below, then return to delete your account."
        );
        return;
      }
      const setup = await client.getDeletionTrust();
      if (setup.accountId !== accountId) {
        throw new Error("Account changed");
      }
      setPrepared(setup);
      emailVersion.current = settings.emailVersion;
      setConfirmed(false);
      setMessage("");
    });
  const complete = async (value: string, pinned: DeletionTrust) => {
    const verification = await client.getDeletionVerification();
    if (verification.instanceId !== pinned.instanceId) {
      throw new Error("Instance changed");
    }
    const continued = { ...pinned, rotations: verification.rotations };
    await verifyDeletionReceipt(value, continued);
    setPrepared(continued);
    setReceipt(value);
    setMessage(
      "Your account and library have been deleted. The signed receipt has been verified."
    );
    await onDeleted(pinned);
  };
  const remove = () =>
    run(async () => {
      if (!trust || !confirmed) {
        return;
      }
      // Pin the key before confirmation; a replacement server key is never accepted.
      recovery.persist(trust);
      setMessage(
        "Deletion is pending. Completion has not yet been confirmed. Check again shortly."
      );
      try {
        const result = await client.deleteAccount({
          accountId: trust.accountId,
          emailVersion: emailVersion.current,
          confirmation: "delete-account",
        });
        if (result.status === "deleted") {
          await complete(result.receipt, trust);
        }
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          recovery.persist(null);
          setPrepared(null);
        }
        throw error;
      }
    });
  const check = () =>
    run(async () => {
      if (!trust) {
        return;
      }
      const result = await client.getDeletionReceipt(trust.handle);
      if (result.status === "deleted") {
        await complete(result.receipt, trust);
      } else {
        setMessage(
          "Deletion is still pending. No verified completion receipt is available. Check again shortly."
        );
      }
    });
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ ...trust, receipt }, null, 2)], {
        type: "application/json",
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "pr0-deletion-receipt.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  if (!accountId && !pending && !receipt) {
    return null;
  }
  return (
    <section
      aria-labelledby="delete-account-title"
      className="space-y-3 rounded-lg border p-6"
    >
      <h2 id="delete-account-title" className="font-semibold">
        Delete account
      </h2>
      <p ref={status} aria-live="polite" tabIndex={-1}>
        {message ||
          (pending
            ? "Deletion is pending. Check its status to verify completion."
            : "")}
      </p>
      {receipt ? (
        <div className="flex gap-3">
          <button type="button" className={buttonClass} onClick={download}>
            Download deletion receipt
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              recovery.persist(null);
              setPrepared(null);
              setReceipt("");
              setMessage("");
            }}
          >
            Finish
          </button>
        </div>
      ) : null}
      {pending && !receipt ? (
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            void check();
          }}
        >
          Check deletion status
        </button>
      ) : null}
      {!pending && !trust ? (
        <button
          ref={opener}
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            void prepare();
          }}
        >
          Delete account
        </button>
      ) : null}
      {!pending && trust ? (
        <section aria-labelledby="confirm-deletion-title" className="space-y-3">
          <h3 id="confirm-deletion-title" className="font-semibold">
            Confirm account deletion
          </h3>
          <p>
            This permanently removes your account, prompts, organization,
            sessions and unsaved edits. It cannot be undone. Disconnected
            desktops clear their copies when they reconnect and verify deletion.
            Ordinary backups expire within 30 days.
          </p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I understand that my account and entire library will be permanently
            deleted
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !confirmed}
              onClick={() => {
                void remove();
              }}
            >
              Permanently delete account and library
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                setPrepared(null);
                setConfirmed(false);
                requestAnimationFrame(() => opener.current?.focus());
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
};
