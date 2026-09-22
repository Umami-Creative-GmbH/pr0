import de from "../locales/de.json";
import en from "../locales/en.json";
import { currentLocale } from "./locale";
import type { Locale } from "./locale";

const german = new Map(Object.entries(de));
const messages = new Map<string, Record<Locale, string>>();
const placeholders = /\{(?<index>\d+)\}/gu;
const regexCharacters = /[.*+?^${}()|[\]\\]/gu;
const patterns: {
  key: string;
  pattern: RegExp;
  resource: Record<Locale, string>;
  specificity: number;
}[] = [];
const patternFor = (source: string) => {
  let pattern = "^";
  let end = 0;
  let specificity = 0;
  for (const token of source.matchAll(placeholders)) {
    const literal = source.slice(end, token.index);
    specificity += literal.length;
    pattern += literal.replace(regexCharacters, "\\$&");
    pattern += `(?<p${token.groups?.index}>.*?)`;
    end = token.index + token[0].length;
  }
  const literal = source.slice(end);
  specificity += literal.length;
  pattern += `${literal.replace(regexCharacters, "\\$&")}$`;
  return { pattern: new RegExp(pattern, "su"), specificity };
};
for (const [key, english] of Object.entries(en)) {
  const translated = german.get(key) ?? english;
  const resource = { en: english, de: translated };
  messages.set(english, resource);
  messages.set(translated, resource);
  if (english.includes("{0}")) {
    patterns.push(
      { key, resource, ...patternFor(english) },
      { key, resource, ...patternFor(translated) }
    );
  }
}
patterns.sort((left, right) => right.specificity - left.specificity);

// These placeholders are other application messages. All other placeholders
// (including user names and titles) are copied verbatim, never translated.
const nestedMessages = new Set([
  "unconfirmedSaveDetail",
  "notSavedValue",
  "couldNotCopyValue",
  "valueReturnToTheDesktopAndStartANewApproval",
  "valueUnseenTextWasPreservedInAConflictCopy",
]);

/** Adapter for fixed messages from validation/REST and retained UI notices.
 * Call only for application messages, never for user titles, tags or content.
 */
export const localizeMessage = (
  message: string | null | undefined,
  locale: Locale = currentLocale()
): string => {
  if (!message) {
    return "";
  }
  const fixed = messages.get(message);
  if (fixed) {
    return fixed[locale];
  }
  for (const entry of patterns) {
    const match = entry.pattern.exec(message);
    if (match) {
      return entry.resource[locale].replace(
        placeholders,
        (token, index: string) => {
          const value = match.groups?.[`p${index}`];
          if (value === undefined) {
            return token;
          }
          return nestedMessages.has(entry.key)
            ? (messages.get(value)?.[locale] ?? value)
            : value;
        }
      );
    }
  }
  return message;
};
