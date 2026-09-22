import type { Prompt } from "@pr0/api-contract/prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useLocale, useTranslations } from "@pr0/ui/hooks/use-translations";
import { useState } from "react";

import { downloadError, libraryClient } from "./library-client";
import type { Status } from "./use-auth-session";

export const RecoveryLibrary = ({
  count,
  account,
}: {
  count: number;
  account: Status;
}) => {
  const locale = useLocale();

  const t = useTranslations();

  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof libraryClient.recoveryBrowse>>
  >([]);
  const [offset, setOffset] = useState(0);
  const [prompt, setPrompt] = useState<Prompt>();
  const [message, setMessage] = useState("");
  const browse = async (next: number) => {
    try {
      setRows(await libraryClient.recoveryBrowse(next));
      setOffset(next);
    } catch (error) {
      setMessage(downloadError(error));
    }
  };
  const open = async (snapshotId: string, id: string) => {
    try {
      setPrompt(await libraryClient.recoveryDetail(snapshotId, id));
    } catch (error) {
      setMessage(downloadError(error));
    }
  };
  const copy = async () => {
    if (!prompt) {
      return;
    }
    try {
      await libraryClient.copyDraft({
        instanceId: prompt.instanceId,
        accountId: prompt.accountId,
        generation: account.generation,
        promptId: prompt.id,
        operationId: crypto.randomUUID(),
        expectedLocalRevision: null,
        desired: {
          title: prompt.title,
          description: prompt.description,
          content: prompt.content,
        },
      });
      setMessage(t("recoveryTextCopiedPasteIntoANewPromptToSave"));
    } catch {
      setMessage(t("couldNotCopyRecoveryTextSelectTheTextBelowTo"));
    }
  };
  return (
    <details className="space-y-3 rounded border p-4">
      <summary className="cursor-pointer font-semibold">
        {t("reviewPreRecoveryLibrary")}
        {count} {t("retainedPrompts")}
      </summary>
      <p>{t("theServerWasRestoredThisLocalSnapshotPreservesYourEarlier")}</p>
      <button
        className="mr-2 rounded border px-3 py-2 disabled:opacity-50"
        type="button"
        onClick={() => {
          void browse(0);
        }}
      >
        {t("showRetainedPrompts")}
      </button>
      <ul className="space-y-2">
        {rows.map((entry) => (
          <li
            className="flex flex-wrap items-center gap-2"
            key={`${entry.snapshotId}:${entry.promptId}`}
          >
            <button
              className="mr-2 rounded border px-3 py-2 disabled:opacity-50"
              type="button"
              onClick={() => {
                void open(entry.snapshotId, entry.promptId);
              }}
            >
              {entry.title}
            </button>{" "}
            <time dateTime={entry.capturedAt}>
              {new Date(entry.capturedAt).toLocaleString(locale)}
            </time>
          </li>
        ))}
      </ul>
      <button
        className="mr-2 rounded border px-3 py-2 disabled:opacity-50"
        type="button"
        disabled={offset === 0}
        onClick={() => {
          void browse(Math.max(0, offset - 50));
        }}
      >
        {t("previousRetainedPrompts")}
      </button>
      <button
        className="mr-2 rounded border px-3 py-2 disabled:opacity-50"
        type="button"
        disabled={offset + rows.length >= count || rows.length === 0}
        onClick={() => {
          void browse(offset + 50);
        }}
      >
        {t("nextRetainedPrompts")}
      </button>
      {prompt ? (
        <section aria-label={t("retainedPrompt")} className="space-y-2">
          <h3>{prompt.title}</h3>
          <p>{prompt.description}</p>
          <pre className="whitespace-pre-wrap">{prompt.content}</pre>
          <button
            className="mr-2 rounded border px-3 py-2 disabled:opacity-50"
            type="button"
            onClick={() => {
              void copy();
            }}
          >
            {t("copyRecoveryText")}
          </button>
        </section>
      ) : null}
      <output>
        <LocalizedMessage value={message} />
      </output>
    </details>
  );
};
