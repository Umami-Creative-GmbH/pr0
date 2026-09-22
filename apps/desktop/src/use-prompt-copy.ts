import type { DesktopCopy } from "@pr0/api-contract/desktop-copy";
import type { Prompt } from "@pr0/api-contract/prompts";
import { parseTemplate } from "@pr0/api-contract/variables";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { listen } from "@tauri-apps/api/event";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { launcherClient } from "./launcher-client";
import { libraryClient } from "./library-client";
import { listenWhenVisible } from "./surface-visibility";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC errors are untrusted; display only fixed messages.
export const copyError = (error: unknown) => {
  if (error === "clipboard_busy") {
    return translate("anotherCopyIsInProgressWaitForItToFinish");
  }
  if (error === "operation_cancelled") {
    return translate("theAccountChangedSelectThePromptAgainBeforeCopying");
  }
  if (error === "prompt_unavailable" || error === "prompt_not_found") {
    return translate("thisPromptIsNoLongerAvailableRefreshTheLibrary");
  }
  if (error === "template_changed") {
    return translate(
      "templateChangedRestartWithTheUpdatedTemplateBeforeCopying"
    );
  }
  if (error === "invalid_variable_values") {
    return translate("checkTheVariableValuesNothingWasCopied");
  }
  if (error === "variable_output_too_large") {
    return translate("combinedOutputMustBeAtMost256KibOfUtf");
  }
  if (error instanceof Error && error.message === "copy_uncertain") {
    return translate("copyCouldNotBeConfirmedCheckTheClipboardBeforeCopying");
  }
  return translate("couldNotCopyYourPromptIsPreservedTryCopyAgain");
};

interface Interaction {
  prompt: Prompt;
  changed: boolean;
  opener: Element | null;
}
interface Account {
  instanceId?: string | null;
  accountId?: string | null;
  generation: number;
}

export const usePromptCopy = (
  account: Account,
  refresh: () => void,
  opening?: number
) => {
  const t = useTranslations();

  const alive = useRef(true);
  const operation = useRef(0);
  const writing = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [interaction, setInteraction] = useState<Interaction>();
  // oxlint-disable react/exhaustive-effect-dependencies, react/set-state-in-effect -- A native session change cancels IPC operations and clears their UI before the next paint.
  useLayoutEffect(() => {
    // Invalidate only the copy session; the library's editor keeps its draft.
    operation.current += 1;
    writing.current = null;
    setBusy(false);
    setMessage("");
    setInteraction(undefined);
  }, [account.instanceId, account.accountId, account.generation, opening]);
  // oxlint-enable react/exhaustive-effect-dependencies, react/set-state-in-effect
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current += 1;
    };
  }, []);
  const requestFor = (promptId: string): DesktopCopy => ({
    instanceId: account.instanceId ?? "",
    accountId: account.accountId ?? "",
    generation: account.generation,
    promptId,
  });
  const current = (attempt: number) =>
    alive.current && operation.current === attempt;
  const endInteraction = () => {
    operation.current += 1;
    setInteraction(undefined);
    setMessage("");
  };
  const observe = async () => {
    if (!interaction) {
      return;
    }
    const attempt = operation.current;
    try {
      const latest = await libraryClient.copyTemplate(
        requestFor(interaction.prompt.id),
        opening
      );
      if (current(attempt)) {
        setInteraction((value) =>
          value
            ? {
                ...value,
                changed:
                  value.changed || latest.content !== value.prompt.content,
              }
            : value
        );
      }
    } catch (error) {
      if (
        current(attempt) &&
        (error === "prompt_not_found" ||
          error === "prompt_unavailable" ||
          error === "operation_cancelled")
      ) {
        endInteraction();
      }
    }
  };
  const onObservedChange = useEffectEvent(() => {
    void observe();
  });
  const onInvalidated = useEffectEvent(endInteraction);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    let stopInvalidation: (() => void) | undefined;
    const connect = async () => {
      try {
        const off = await listenWhenVisible("library-changed", () =>
          onObservedChange()
        );
        if (disposed) {
          off();
        } else {
          stop = off;
        }
        const offInvalidation = await listen("copy-cancelled", () =>
          onInvalidated()
        );
        if (disposed) {
          offInvalidation();
        } else {
          stopInvalidation = offInvalidation;
        }
      } catch {
        // Native checks still revalidate at final Copy; focus also refreshes the form.
      }
    };
    void connect();
    window.addEventListener("focus", onObservedChange);
    return () => {
      disposed = true;
      stop?.();
      stopInvalidation?.();
      window.removeEventListener("focus", onObservedChange);
    };
  }, []);
  const submit = async (prompt: Prompt, values: [string, string][] = []) => {
    if (writing.current !== null) {
      return;
    }
    const attempt = operation.current;
    writing.current = attempt;
    setBusy(true);
    setMessage("");
    try {
      const request = {
        ...requestFor(prompt.id),
        template: prompt.content,
        values,
      };
      const result =
        opening === undefined
          ? await libraryClient.copy(request)
          : await launcherClient.copy(request, opening);
      if (current(attempt)) {
        setInteraction(undefined);
        setMessage(
          result.usageSaved
            ? t("copied2")
            : t("copiedUsageCouldNotBeSavedRetryUsageWithoutCopying")
        );
        refresh();
      }
    } catch (error) {
      if (current(attempt)) {
        setMessage(copyError(error));
        if (error === "template_changed") {
          setInteraction((value) =>
            value
              ? { ...value, changed: true }
              : { prompt, changed: true, opener: document.activeElement }
          );
        }
        if (
          error === "prompt_not_found" ||
          error === "prompt_unavailable" ||
          error === "operation_cancelled"
        ) {
          endInteraction();
        }
      }
    }
    if (writing.current === attempt) {
      writing.current = null;
      if (alive.current) {
        setBusy(false);
      }
    }
  };
  const handleCopy = async (promptId: string) => {
    if (writing.current !== null || !account.instanceId || !account.accountId) {
      return;
    }
    const opener = document.activeElement;
    operation.current += 1;
    const attempt = operation.current;
    setMessage("");
    try {
      const prompt = await libraryClient.copyTemplate(
        requestFor(promptId),
        opening
      );
      if (!current(attempt)) {
        return;
      }
      if (parseTemplate(prompt.content).fields.length) {
        setInteraction({ prompt, changed: false, opener });
      } else {
        await submit(prompt);
      }
    } catch (error) {
      if (current(attempt)) {
        setMessage(copyError(error));
      }
    }
  };
  const restartVariables = async () => {
    if (!interaction || writing.current !== null) {
      return;
    }
    const attempt = operation.current;
    try {
      const prompt = await libraryClient.copyTemplate(
        requestFor(interaction.prompt.id),
        opening
      );
      if (current(attempt)) {
        setInteraction({ ...interaction, prompt, changed: false });
        setMessage("");
      }
    } catch (error) {
      if (current(attempt)) {
        setMessage(copyError(error));
        await observe();
      }
    }
  };
  return {
    busy,
    launcher: opening !== undefined,
    message,
    interaction,
    handleCopy,
    submit,
    restartVariables,
    cancelVariables: () => {
      if (writing.current === null) {
        endInteraction();
      }
    },
    invalidate: endInteraction,
    usageRetried: () =>
      setMessage(t("usageSavedTheClipboardWasNotWrittenAgain")),
  };
};
