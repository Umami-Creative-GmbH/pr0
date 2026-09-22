"use client";
import { usePresentationTime } from "../hooks/use-presentation-time";
import { useLocale, useTranslations } from "../hooks/use-translations";
import { translate } from "../lib/i18n";
import type { Locale } from "../lib/locale";

const age = (at: string, now: number, locale: Locale) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 1) {
    return translate("justNow", [], locale);
  }
  if (minutes < 60) {
    return new Intl.RelativeTimeFormat(locale).format(-minutes, "minute");
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return new Intl.RelativeTimeFormat(locale).format(-hours, "hour");
  }
  const days = Math.floor(hours / 24);
  return new Intl.RelativeTimeFormat(locale).format(-days, "day");
};
export const LastChecked = ({ at }: { at?: string | null }) => {
  const t = useTranslations();
  const locale = useLocale();

  const now = usePresentationTime();
  return at ? (
    <p>
      {t("lastCheckedForUpdates")}{" "}
      <time dateTime={at} title={new Date(at).toLocaleString(locale)}>
        {age(at, now, locale)}
      </time>
      .
      <span className="block text-sm">
        {t("exactCheckTime")} {new Date(at).toLocaleString(locale)}
        {t("otherDevicesMayStillHaveChangesToUpload")}
      </span>
    </p>
  ) : (
    <p>{t("notYetCheckedForUpdates")}</p>
  );
};
