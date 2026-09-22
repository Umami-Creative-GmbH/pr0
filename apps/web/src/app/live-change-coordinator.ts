import { createChangeClient } from "@pr0/api-client/changes";
import { PromptApiError } from "@pr0/api-client/prompts";
import { translate } from "@pr0/ui/lib/i18n";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

import { refreshLibrary } from "./refresh-library";

export interface LiveStatus {
  label: string;
  lastCheckedAt: string | null;
}
interface CoordinatorOptions {
  baseUrl: string;
  accountId: string;
  instanceId: string;
  epoch: string;
  queryClient: QueryClient;
  setStatus: Dispatch<SetStateAction<LiveStatus>>;
}
export const startLiveChanges = ({
  baseUrl,
  accountId,
  instanceId,
  epoch,
  queryClient,
  setStatus,
}: CoordinatorOptions) => {
  const client = createChangeClient(baseUrl, {
    instanceId,
    accountId,
    epoch,
  });
  const scope = [baseUrl, instanceId, accountId];
  let disposed = false;
  let cursor: string | undefined;
  let revision: string | undefined;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let requested = false;
  let attempts = 0;
  let nextAttempt = 0;
  let stopped = false;
  const failed = (error: Error) => {
    const detail = error instanceof PromptApiError ? error.detail : undefined;
    const authentication =
      error instanceof PromptApiError && [401, 403].includes(error.status);
    stopped = detail?.code === "snapshot_required";
    let label = navigator.onLine
      ? translate("couldnTCheckForUpdates")
      : translate("offline");
    if (authentication) {
      label = translate("signInToSync");
    }
    if (detail?.code === "account_suspended") {
      label = translate(
        "accountSuspendedDraftsRetainedContactYourInstanceOperator"
      );
    } else if (detail?.retryAfter) {
      label = translate("serviceBusyRetryingInValueSecondsDraftsRetained", [
        detail.retryAfter,
      ]);
    }
    if (stopped) {
      label = translate("libraryRecoveryRequiredDraftsRetained");
    }
    setStatus((prior) => ({ ...prior, label }));
    const delay = Math.max(
      Math.min(300_000, 1000 * 2 ** Math.min(attempts, 9)),
      (detail?.retryAfter ?? 0) * 1000
    );
    attempts += 1;
    nextAttempt = Date.now() + delay + Math.random() * 1000;
  };
  const run = async () => {
    if (disposed || running || stopped) {
      return;
    }
    clearTimeout(timer);
    if (Date.now() < nextAttempt) {
      timer = setTimeout(() => {
        void run();
      }, nextAttempt - Date.now());
      return;
    }
    running = true;
    requested = false;
    controller = new AbortController();
    try {
      const page = await client.poll(
        { cursor, wait: cursor ? 25 : 0 },
        controller.signal
      );
      if (disposed) {
        return;
      }
      if (revision !== undefined && page.fromRevision !== revision) {
        throw new Error("invalid_response");
      }
      if (!cursor || page.changes.length) {
        setStatus((prior) => ({
          ...prior,
          label: translate("updatingLibrary"),
        }));
        await refreshLibrary(queryClient, scope);
      }
      if (disposed) {
        return;
      }
      ({ cursor, revision } = page);

      attempts = 0;
      nextAttempt = 0;
      if (!page.hasMore) {
        setStatus({
          label: translate("upToDateAtLastCheck"),
          lastCheckedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (disposed) {
        return;
      }
      if (!controller.signal.aborted || !requested) {
        failed(
          error instanceof Error ? error : new Error("Change request failed")
        );
      }
    } finally {
      running = false;
      if (!disposed && !stopped) {
        timer = setTimeout(
          () => {
            void run();
          },
          Math.max(0, nextAttempt - Date.now())
        );
      }
    }
  };
  const wake = () => {
    if (disposed || document.visibilityState === "hidden") {
      return;
    }
    requested = true;
    // Do not interrupt a server-mandated retry delay or start a second poll.
    if (nextAttempt <= Date.now()) {
      controller?.abort();
      if (!running) {
        clearTimeout(timer);
        void run();
      }
    }
  };
  const saved = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === scope.join(":")) {
      wake();
    }
  };
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("pr0:library-saved", saved);
  void run();
  return () => {
    disposed = true;
    controller?.abort();
    clearTimeout(timer);
    window.removeEventListener("online", wake);
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("pr0:library-saved", saved);
  };
};
