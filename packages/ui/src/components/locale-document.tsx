"use client";

import { useEffect } from "react";

import { useLocale } from "../hooks/use-translations";

/** Keep assistive technology aligned with the device's current UI language. */
export const LocaleDocument = () => {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
};
