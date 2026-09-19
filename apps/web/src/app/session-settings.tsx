"use client";

import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { accountErrorMessage } from "./account-errors";

export const SessionSettings = ({ accountId }: { accountId: string }) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const sessions = useQuery({
    queryKey: ["account-sessions", client.baseUrl, accountId],
    queryFn: ({ signal }) => client.getSessions(signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const revoke = async (id?: string) => {
    setBusy(true);
    setMessage("");
    try {
      await (id ? client.revokeSession(id) : client.revokeOtherSessions());
      await queryClient.invalidateQueries({
        queryKey: ["account-library", client.baseUrl],
      });
      const refreshed = await sessions.refetch();
      if (refreshed.error) {
        setMessage(accountErrorMessage(refreshed.error));
      } else {
        setMessage(
          id
            ? "Session revoked."
            : "All other sessions revoked. This session is still signed in."
        );
      }
    } catch (error) {
      setMessage(
        accountErrorMessage(
          error instanceof Error ? error : new Error("Revocation failed")
        )
      );
      if (error instanceof ApiError && error.status === 401) {
        await queryClient.invalidateQueries({
          queryKey: ["account-library", client.baseUrl],
        });
      }
    }
    setBusy(false);
    statusRef.current?.focus();
  };
  return (
    <section aria-labelledby="sessions-title" className="rounded-lg border p-6">
      <h2 className="text-xl font-medium" id="sessions-title">
        Active sessions
      </h2>
      <p className="mt-2 text-sm">
        Sessions expire after 30 days without authenticated activity. Revoking a
        desktop session stops online access; saved local work stays on that
        device.
      </p>
      <p
        aria-live="polite"
        className="my-3 text-sm"
        ref={statusRef}
        tabIndex={-1}
      >
        {message}
      </p>
      {sessions.isPending ? <output>Loading sessions…</output> : null}
      {sessions.isError ? (
        <p role="alert">
          {accountErrorMessage(sessions.error)}{" "}
          <button
            className="underline"
            onClick={() => {
              void sessions.refetch();
            }}
            type="button"
          >
            Retry sessions
          </button>
        </p>
      ) : null}
      {sessions.data && !sessions.isError ? (
        <>
          <ul className="space-y-4">
            {sessions.data.sessions.map((session) => (
              <li className="rounded border p-3" key={session.id}>
                <h3 className="font-medium">
                  {session.provenance === "device" ? "Desktop" : "Browser"}
                  {session.current ? " · This session" : ""}
                </h3>
                <p className="text-sm break-all">
                  {session.userAgent ?? "Client details unavailable"}
                </p>
                <dl className="mt-2 text-sm break-all">
                  <dt>Session identity</dt>
                  <dd>{session.id}</dd>
                  <dt>Signed in</dt>
                  <dd>{new Date(session.createdAt).toLocaleString()}</dd>
                  <dt>Last active</dt>
                  <dd>{new Date(session.lastActiveAt).toLocaleString()}</dd>
                  <dt>Expires</dt>
                  <dd>{new Date(session.expiresAt).toLocaleString()}</dd>
                </dl>
                <button
                  aria-label={`Revoke ${session.current ? "this session" : `session ${session.id}`}`}
                  className="mt-3 rounded-md border px-4 py-2"
                  disabled={busy}
                  onClick={() => {
                    void revoke(session.id);
                  }}
                  type="button"
                >
                  {session.current ? "Revoke this session" : "Revoke session"}
                </button>
              </li>
            ))}
          </ul>
          <button
            className="mt-4 rounded-md border px-4 py-2"
            disabled={busy || sessions.data.sessions.length < 2}
            onClick={() => {
              void revoke();
            }}
            type="button"
          >
            Revoke all other sessions
          </button>
        </>
      ) : null}
    </section>
  );
};
