"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { promptLimits } from "@pr0/api-contract/prompts";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { PromptEditor } from "./prompt-editor";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const errorMessage = (error: Error) =>
  error instanceof PromptApiError
    ? error.message
    : "Could not load prompts. Try again.";
const PromptDetail = ({
  id,
  library,
}: {
  id: string;
  library: PrivateLibrary;
}) => {
  const client = useApiClient();
  const detail = useQuery({
    queryKey: [
      "prompt",
      client.baseUrl,
      library.instance.id,
      library.account.id,
      id,
    ],
    queryFn: ({ signal }) =>
      client.getPrompt(id, signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    retry: false,
  });
  return (
    <section aria-labelledby="detail-heading" className="rounded-lg border p-6">
      <h2 className="text-xl font-semibold break-words" id="detail-heading">
        {detail.data?.title ?? "Prompt detail"}
      </h2>
      {detail.isPending ? <output>Loading prompt…</output> : null}
      {detail.isError ? (
        <div role="alert">
          <p>{errorMessage(detail.error)}</p>
          <button
            className={buttonClass}
            onClick={() => {
              void detail.refetch();
            }}
            type="button"
          >
            Retry detail
          </button>
        </div>
      ) : null}
      {detail.data ? (
        <>
          {detail.data.description ? (
            <p className="mt-3 break-words whitespace-pre-wrap">
              {detail.data.description}
            </p>
          ) : null}
          <h3 className="mt-4 font-medium">Content</h3>
          <textarea
            aria-label="Saved content"
            className="bg-background mt-2 max-h-96 w-full rounded-md border p-3 font-mono text-sm"
            readOnly
            rows={10}
            value={detail.data.content}
          />
          <p className="text-muted-foreground mt-3 text-sm">
            Created{" "}
            <time dateTime={detail.data.createdAt}>
              {new Date(detail.data.createdAt).toLocaleString()}
            </time>{" "}
            · Modified{" "}
            <time dateTime={detail.data.modifiedAt}>
              {new Date(detail.data.modifiedAt).toLocaleString()}
            </time>
          </p>
        </>
      ) : null}
    </section>
  );
};
export const PromptLibrary = ({
  library,
  onDirtyChange,
}: {
  library: PrivateLibrary;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const createRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      createRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  const queryKey = [
    "prompts",
    client.baseUrl,
    library.instance.id,
    library.account.id,
  ];
  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      client.getPrompts({ cursor: pageParam || undefined }, signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const usage = list.data?.pages[0]?.usage;
  const prompts = list.data?.pages.flatMap((page) => page.prompts) ?? [];
  const empty = !list.isPending && !list.isError && !prompts.length;
  const saved = (id: string) => {
    restoreFocus.current = true;
    setEditing(false);
    setSelected(id);
    setNotice("Saved to server.");
    void queryClient.resetQueries({ queryKey });
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite">{notice}</p>
        <button
          className={buttonClass}
          disabled={editing}
          onClick={() => {
            setEditing(true);
            setNotice("");
          }}
          ref={createRef}
          type="button"
        >
          Create prompt
        </button>
      </div>
      {usage ? (
        <p className="text-muted-foreground text-sm">
          {usage.promptCount.toLocaleString()} / 10,000 prompts ·{" "}
          {(usage.textBytes / 1_048_576).toFixed(2)} / 100 MiB of text
        </p>
      ) : null}
      {usage &&
      (usage.promptCount >= promptLimits.promptCount * 0.9 ||
        usage.textBytes >= promptLimits.libraryBytes * 0.9) ? (
        <output>
          Your library is at or above 90% capacity. Archiving does not free
          capacity.
        </output>
      ) : null}
      {editing ? (
        <PromptEditor
          library={library}
          onCancel={() => {
            restoreFocus.current = true;
            setEditing(false);
          }}
          onDirtyChange={onDirtyChange}
          onSaved={saved}
        />
      ) : null}
      <section
        aria-labelledby="prompts-heading"
        className="rounded-lg border p-6"
      >
        <h2 className="text-xl font-semibold" id="prompts-heading">
          {empty ? "Your library is empty" : "Saved prompts"}
        </h2>
        {list.isPending ? <output>Loading your library…</output> : null}
        {empty ? (
          <p className="text-muted-foreground mt-2">
            Create your first prompt with a title and content.
          </p>
        ) : null}
        {list.isError ? (
          <div role="alert">
            <p>{errorMessage(list.error)}</p>
            <button
              className={buttonClass}
              onClick={() => {
                void queryClient.resetQueries({ queryKey });
              }}
              type="button"
            >
              Refresh list
            </button>
          </div>
        ) : null}
        <ul className="mt-4 space-y-2">
          {prompts.map((prompt) => (
            <li key={prompt.id}>
              <button
                aria-pressed={selected === prompt.id}
                className="w-full rounded-md border px-3 py-3 text-left break-words focus-visible:outline-2 focus-visible:outline-offset-2"
                onClick={() => setSelected(prompt.id)}
                type="button"
              >
                <span className="block font-medium">{prompt.title}</span>
                {prompt.description ? (
                  <span className="text-muted-foreground mt-1 block text-sm">
                    {prompt.description}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {list.hasNextPage ? (
          <button
            className={`${buttonClass} mt-4`}
            disabled={list.isFetchingNextPage || list.isError}
            onClick={() => {
              void list.fetchNextPage();
            }}
            type="button"
          >
            {list.isFetchingNextPage ? "Loading…" : "Load more prompts"}
          </button>
        ) : null}
      </section>
      {selected ? (
        <PromptDetail id={selected} key={selected} library={library} />
      ) : null}
    </div>
  );
};
