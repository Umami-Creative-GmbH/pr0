import de from "../locales/de.json";
import en from "../locales/en.json";
import { currentLocale } from "./locale";
import type { Locale } from "./locale";

export type MessageKey = keyof typeof en;
type Catalog = Record<MessageKey, string>;
const catalogs: Record<Locale, Catalog> = { en, de };
const placeholder = /\{(?<index>\d+)\}/gu;

/** English UI phrases use lowercase nouns; German nouns retain their capitals. */
export const localizedLabel = (label: string) =>
  currentLocale() === "en" ? label.toLowerCase() : label;

/** Interpolate only resource placeholders; supplied text is never reinterpreted. */
export const translate = (
  key: MessageKey,
  values: readonly (string | number | null)[] = [],
  locale: Locale = currentLocale()
): string =>
  catalogs[locale][key].replace(placeholder, (token, index: string) =>
    values[Number(index)] === undefined
      ? token
      : String(values[Number(index)] ?? "")
  );
