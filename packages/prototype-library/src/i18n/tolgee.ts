/**
 * PROTOTYPE (issue #9) — Tolgee setup.
 *
 * Runs against local static catalogues so the prototype needs no server.
 * Pointing it at the self-hosted Tolgee instance later is a config change:
 * supply `apiUrl` and `apiKey` and the same keys resolve from the platform.
 * The JSON catalogues use flat ICU keys, so they import into Tolgee as-is.
 */

import { FormatIcu } from "@tolgee/format-icu";
import { DevTools, Tolgee } from "@tolgee/react";

import de from "./de.json";
import en from "./en.json";

export const SUPPORTED_LANGUAGES = ["de", "en"] as const;

export type LanguageTag = (typeof SUPPORTED_LANGUAGES)[number];

/** German is the design's source language; English is the first translation. */
export const DEFAULT_LANGUAGE: LanguageTag = "de";

export const LANGUAGE_LABELS: Record<LanguageTag, string> = {
  de: "Deutsch",
  en: "English",
};

export const isLanguageTag = (value: string): value is LanguageTag =>
  // SAFETY: widening a readonly tuple of string literals to readonly string[]
  // only loosens the element type; it cannot introduce a new member.
  (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

export interface TolgeeOptions {
  language?: LanguageTag;
  /** Self-hosted Tolgee base URL, e.g. https://tolgee.example.com */
  apiUrl?: string;
  apiKey?: string;
}

export const createTolgee = (options: TolgeeOptions = {}) =>
  Tolgee()
    .use(DevTools())
    .use(FormatIcu())
    .init({
      language: options.language ?? DEFAULT_LANGUAGE,
      fallbackLanguage: DEFAULT_LANGUAGE,
      availableLanguages: [...SUPPORTED_LANGUAGES],
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      staticData: { de, en },
    });
