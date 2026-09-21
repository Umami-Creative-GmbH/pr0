import type { Prompt } from "@pr0/api-contract/prompts";
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
      setMessage(
        "Recovery text copied. Paste into a new prompt to save a separate copy."
      );
    } catch {
      setMessage(
        "Could not copy recovery text. Select the text below to copy it, or retry."
      );
    }
  };
  return (
    <details className="space-y-3 rounded border p-4">
      <summary className="cursor-pointer font-semibold">
        Review pre-recovery library ({count} retained prompts)
      </summary>
      <p>
        The server was restored. This local snapshot preserves your earlier
        library and saved variants. Previously acknowledged prompts are not
        uploaded automatically. Review and copy any text you need to preserve.
      </p>
      <button
        className="mr-2 rounded border px-3 py-2 disabled:opacity-50"
        type="button"
        onClick={() => {
          void browse(0);
        }}
      >
        Show retained prompts
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
              {new Date(entry.capturedAt).toLocaleString()}
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
        Previous retained prompts
      </button>
      <button
        className="mr-2 rounded border px-3 py-2 disabled:opacity-50"
        type="button"
        disabled={offset + rows.length >= count || rows.length === 0}
        onClick={() => {
          void browse(offset + 50);
        }}
      >
        Next retained prompts
      </button>
      {prompt ? (
        <section aria-label="Retained prompt" className="space-y-2">
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
            Copy recovery text
          </button>
        </section>
      ) : null}
      <output>{message}</output>
    </details>
  );
};
