import {
  desktopStatusSchema,
  signOutRequestSchema,
} from "@pr0/api-contract/desktop-session";
import type {
  DesktopStatus,
  SignOutRequest,
} from "@pr0/api-contract/desktop-session";
import { translate } from "@pr0/ui/lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { listenWhenVisible, surfaceVisible } from "./surface-visibility";
import { upgradeRecoveryMessage } from "./upgrade-recovery";

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
const errorKeys = {
  invalid_deletion_evidence:
    "deletionEvidenceCouldNotBeVerifiedLocalWorkIsPreserved" as const,
  sync_incomplete:
    "synchronizationDidNotCompleteLocalWorkIsPreservedRetryCancel" as const,
  network_unavailable:
    "theServerCouldNotBeReachedLocalWorkIsPreserved" as const,
  storage_unavailable:
    "localCleanupCouldNotFinishCheckStorageAccessAndRetry" as const,
  cleanup_required:
    "finishSignOutCleanupBeforeChoosingAnotherAccountOrServer" as const,
  transition_in_progress:
    "anAccountTransitionIsStillRunningWaitForItTo" as const,
  operation_cancelled:
    "theAccountOperationWasCancelledRefreshTheCurrentAccountBefore" as const,
  discard_confirmation_required:
    "confirmThatPendingLocalChangesWillBeLostBeforeDiscarding" as const,
  pending_work:
    "changesAreWaitingToSyncSynchronizeFirstCancelOrExplicitly" as const,
  invalid_instance:
    "enterATrustedHttpsServerAddressWithoutAPathUsername" as const,
  incompatible_instance:
    "thisServerIsIncompatibleCheckTheAddressOrUpdatePr0" as const,
  instance_identity_changed:
    "thisServerSIdentityChangedRetainedLocalFilesArePreserved" as const,
  same_account_required: "signInToTheSameAccountOnTheSameServer" as const,
  credential_unavailable:
    "windowsCouldNotAccessTheCredentialRetrySignInOr" as const,
  local_data_requires_review:
    "localFilesCouldNotBeSafelyIdentifiedForCleanupLocal" as const,
  authentication_required:
    "signInAgainToResumeThisSessionLocalFilesAre" as const,
  account_suspended:
    "thisAccountIsSuspendedContactYourInstanceOperatorLocalFiles" as const,
  approval_failed: "approvalWasDeniedExpiredOrAlreadyUsedStartANew" as const,
  redirect_rejected:
    "theServerRedirectedTheRequestUseItsCanonicalHttpsAddress" as const,
};
const errorMessages = new Map(Object.entries(errorKeys));
const messageFor = (code: string | undefined) => {
  const key = code ? errorMessages.get(code) : undefined;
  return code
    ? (upgradeRecoveryMessage(code) ?? (key ? translate(key) : undefined))
    : undefined;
};
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
                ? translate(errorKeys.sync_incomplete)
                : translate(
                    "theOperationDidNotCompleteRetryRetainedLocalFilesAre"
                  ))
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
      if (!surfaceVisible()) {
        return;
      }
      try {
        const next = await command("auth_status");
        if (active) {
          apply(next);
        }
      } catch {
        if (active) {
          setErrorText(translate("theSavedSignInCouldNotBeLoadedRetryLocal"));
        }
      }
    };
    void load();
    const unlisten = listenWhenVisible("auth-changed", () => {
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
              translate("approvalDidNotCompleteStartANewSignInAn")
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
