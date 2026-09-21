import {
  desktopStatusSchema,
  signOutRequestSchema,
} from "@pr0/api-contract/desktop-session";
import type {
  DesktopStatus,
  SignOutRequest,
} from "@pr0/api-contract/desktop-session";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

export type Status = DesktopStatus;
export type Command =
  | "auth_status"
  | "auth_begin"
  | "auth_poll"
  | "auth_cancel"
  | "auth_open_browser"
  | "auth_refresh"
  | "auth_sign_out";
export type AuthRun = (
  name: Command,
  input?: string | SignOutRequest
) => Promise<Status | undefined>;
const command = async (name: Command, input?: string | SignOutRequest) => {
  const args =
    name === "auth_sign_out"
      ? { request: signOutRequestSchema.parse(input) }
      : { origin: z.string().optional().parse(input) };
  return desktopStatusSchema.parse(await invoke(name, args));
};
const errors = {
  invalid_deletion_evidence:
    "Deletion evidence could not be verified. Local work is preserved; check the connection and retry.",
  sync_incomplete:
    "Synchronization did not complete. Local work is preserved. Retry, cancel, or explicitly discard.",
  network_unavailable:
    "The server could not be reached. Local work is preserved. Retry when online, cancel, or explicitly discard.",
  storage_unavailable:
    "Local cleanup could not finish. Check storage access and retry cleanup before signing into another account.",
  cleanup_required:
    "Finish sign-out cleanup before choosing another account or server.",
  transition_in_progress:
    "An account transition is still running. Wait for it to finish or cancel synchronization.",
  operation_cancelled:
    "The account operation was cancelled. Refresh the current account before retrying.",
  discard_confirmation_required:
    "Confirm that pending local changes will be lost before discarding.",
  pending_work:
    "Changes are waiting to sync. Synchronize first, cancel, or explicitly discard them.",
  invalid_instance:
    "Enter a trusted HTTPS server address without a path, username, or query.",
  incompatible_instance:
    "This server is incompatible. Check the address or update pr0.",
  instance_identity_changed:
    "This server's identity changed. Retained local files are preserved. Contact your server operator.",
  same_account_required:
    "Sign in to the same account on the same server. Retained local files cannot move to another account.",
  credential_unavailable:
    "Windows could not access the credential. Retry sign-in or sign-out cleanup; local work remains protected from account switching.",
  local_data_requires_review:
    "Local files could not be safely identified for cleanup. Local work is retained. Check storage access and retry.",
  authentication_required:
    "Sign in again to resume this session. Local files are preserved.",
  account_suspended:
    "This account is suspended. Contact your instance operator. Local files and pending work are retained.",
  approval_failed:
    "Approval was denied, expired, or already used. Start a new sign-in.",
  redirect_rejected:
    "The server redirected the request. Use its canonical HTTPS address.",
};
const errorMessages = new Map(Object.entries(errors));
const messageFor = (code: string | undefined) =>
  code ? errorMessages.get(code) : undefined;
export const useAuthSession = () => {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const requestGeneration = useRef(0);
  const notice = useRef<HTMLParagraphElement>(null);
  const apply = useCallback((next: Status) => {
    setStatus((current) =>
      current && current.generation > next.generation ? current : next
    );
  }, []);
  const run = useCallback(
    async (name: Command, selected?: string | SignOutRequest) => {
      requestGeneration.current += 1;
      const generation = requestGeneration.current;
      setBusy(true);
      setErrorText("");
      let result: Status | undefined;
      try {
        const next = await command(name, selected);
        if (generation === requestGeneration.current) {
          apply(next);
          result = next;
        }
      } catch (error) {
        if (generation === requestGeneration.current) {
          setErrorText(
            messageFor(z.string().safeParse(error).data) ??
              (name === "auth_sign_out" &&
              signOutRequestSchema.safeParse(selected).data?.choice ===
                "synchronize"
                ? errors.sync_incomplete
                : "The operation did not complete. Retry; retained local files are preserved.")
          );
          try {
            const next = await command("auth_status");
            if (generation === requestGeneration.current) {
              apply(next);
            }
          } catch {
            /* Preserve the error if native storage cannot be opened. */
          }
        }
      }
      if (generation === requestGeneration.current) {
        setBusy(false);
        notice.current?.focus();
      }
      return result;
    },
    [apply]
  );
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await command("auth_status");
        if (active) {
          apply(next);
        }
      } catch {
        if (active) {
          setErrorText(
            "The saved sign-in could not be loaded. Retry; local files are preserved."
          );
        }
      }
    };
    void load();
    const unlisten = listen("auth-changed", () => {
      void load();
    });
    const stopListening = async () => {
      const stop = await unlisten;
      stop();
    };
    return () => {
      active = false;
      void stopListening();
    };
  }, [apply]);
  useEffect(() => {
    if (status?.state !== "awaiting_approval") {
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const next = await command("auth_poll");
        if (active) {
          apply(next);
        }
      } catch (error) {
        if (active) {
          await run("auth_status");
          setErrorText(
            messageFor(z.string().safeParse(error).data) ??
              "Approval did not complete. Start a new sign-in. An undelivered session can be revoked in browser settings."
          );
        }
      }
    };
    const timer = setTimeout(
      () => {
        void poll();
      },
      Math.max(1000, status.pollAfterMs)
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status, apply, run]);
  return { status, busy, error: errorText, notice, run };
};
