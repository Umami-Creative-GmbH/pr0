"use client";

import { useSyncExternalStore } from "react";

import { useTranslations } from "../hooks/use-translations";
import {
  languagePreference,
  serverLanguagePreference,
  setLanguagePreference,
  subscribeLanguage,
} from "../lib/locale";

export const LanguageSetting = () => {
  const t = useTranslations();
  const preference = useSyncExternalStore(
    subscribeLanguage,
    languagePreference,
    serverLanguagePreference
  );
  return (
    <select
      className="wf-btn max-w-36"
      aria-label={t("deviceLanguage")}
      value={preference}
      onChange={(event) => {
        const { value } = event.target;
        if (value === "en" || value === "de" || value === "system") {
          setLanguagePreference(value);
        }
      }}
    >
      <option value="system">{t("systemLanguage")}</option>
      <option value="en">{t("englishLanguage")}</option>
      <option value="de">{t("germanLanguage")}</option>
    </select>
  );
};
