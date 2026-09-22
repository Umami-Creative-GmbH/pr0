"use client";
import { ApiError } from "@pr0/api-client/client";
import { useApiClient } from "@pr0/api-client/provider";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useDeviceTimeZone } from "@pr0/ui/hooks/use-device-time-zone";
import { useLocale, useTranslations } from "@pr0/ui/hooks/use-translations";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { accountErrorMessage } from "./account-errors";

export const SessionSettings = ({ accountId }: { accountId: string }) => {
  const locale = useLocale();
  const timeZone = useDeviceTimeZone();

  const t = useTranslations();

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
            ? t("sessionRevoked")
            : t("allOtherSessionsRevokedThisSessionIsStillSignedIn")
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
        {t("activeSessions")}
      </h2>
      <p className="mt-2 text-sm">
        {t("sessionsExpireAfter30DaysWithoutAuthenticatedActivityRevokingA")}
      </p>
      <p
        aria-live="polite"
        className="my-3 text-sm"
        ref={statusRef}
        tabIndex={-1}
      >
        <LocalizedMessage value={message} />
      </p>
      {sessions.isPending ? <output>{t("loadingSessions")}</output> : null}
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
            {t("retrySessions")}
          </button>
        </p>
      ) : null}
      {sessions.data && !sessions.isError ? (
        <>
          <ul className="space-y-4">
            {sessions.data.sessions.map((session) => (
              <li className="rounded border p-3" key={session.id}>
                <h3 className="font-medium">
                  {session.provenance === "device"
                    ? t("desktop")
                    : t("browser")}
                  {session.current ? t("thisSession") : ""}
                </h3>
                <p className="text-sm break-all">
                  {session.userAgent ?? t("clientDetailsUnavailable")}
                </p>
                <dl className="mt-2 text-sm break-all">
                  <dt>{t("sessionIdentity")}</dt>
                  <dd>{session.id}</dd>
                  <dt>{t("signedIn")}</dt>
                  <dd>
                    {new Date(session.createdAt).toLocaleString(locale, {
                      timeZone,
                    })}
                  </dd>
                  <dt>{t("lastActive")}</dt>
                  <dd>
                    {new Date(session.lastActiveAt).toLocaleString(locale, {
                      timeZone,
                    })}
                  </dd>
                  <dt>{t("expires")}</dt>
                  <dd>
                    {new Date(session.expiresAt).toLocaleString(locale, {
                      timeZone,
                    })}
                  </dd>
                </dl>
                <button
                  aria-label={t("revokeValue", [
                    session.current
                      ? t("thisSession2")
                      : t("sessionValue", [session.id]),
                  ])}
                  className="mt-3 rounded-md border px-4 py-2"
                  disabled={busy}
                  onClick={() => {
                    void revoke(session.id);
                  }}
                  type="button"
                >
                  {session.current
                    ? t("revokeThisSession")
                    : t("revokeSession")}
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
            {t("revokeAllOtherSessions")}
          </button>
        </>
      ) : null}
    </section>
  );
};
