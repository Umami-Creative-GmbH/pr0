"use client";

import { useCallback, useSyncExternalStore } from "react";

import { translate } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n";
import { currentLocale, serverLocale, subscribeLanguage } from "../lib/locale";

export const useLocale = () =>
  useSyncExternalStore(subscribeLanguage, currentLocale, serverLocale);

export const useTranslations = () => {
  const locale = useLocale();
  return useCallback(
    (key: MessageKey, values?: readonly (string | number | null)[]) =>
      translate(key, values, locale),
    [locale]
  );
};
