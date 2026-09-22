import { translate } from "./i18n";
import { currentLocale } from "./locale";
import type { Locale } from "./locale";
import { localizeMessage } from "./message-localization";

const namePart = /[\s._+-]+/u;

/** Avatar initials for an email address or display name. */
export const initials = (identity?: string | null) => {
  const [local = ""] = (identity ?? "").trim().split("@");
  const parts = local.split(namePart).filter(Boolean);
  const [first = "", second = ""] = parts;
  const letters = second
    ? `${[...first][0] ?? ""}${[...second][0] ?? ""}`
    : [...first].slice(0, 2).join("");
  return letters.toUpperCase() || "?";
};

export const accents = ["pink", "orange", "green", "blue"] as const;
export type Accent = (typeof accents)[number] | "neutral";
const neutralAccent: Accent = "neutral";
const hashMultiplier = 31;
const hashModulus = 1_000_003;

/** Stable brand accent name for a collection identity, rendered through `data-accent`. */
export const accentFor = (id?: string | null): Accent => {
  if (!id) {
    return neutralAccent;
  }
  let hash = 0;
  for (const character of id) {
    hash =
      (hash * hashMultiplier + (character.codePointAt(0) ?? 0)) % hashModulus;
  }
  return accents[hash % accents.length] ?? neutralAccent;
};

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const recentDays = 30;

/** Compact age for list rows. Exact times stay available through `<time dateTime>`. */
export const relativeTime = (
  iso: string,
  now: number,
  locale: Locale = currentLocale()
) => {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return "";
  }
  const elapsed = Math.max(0, now - at);
  if (elapsed < minute) {
    return translate("justNow", [], locale);
  }
  if (elapsed < hour) {
    return translate("minutesAgo", [Math.floor(elapsed / minute)], locale);
  }
  if (elapsed < day) {
    return translate("hoursAgo", [Math.floor(elapsed / hour)], locale);
  }
  const days = Math.floor(elapsed / day);
  if (days === 1) {
    return translate("yesterday", [], locale);
  }
  return days < recentDays
    ? translate("daysAgo", [days], locale)
    : new Date(at).toLocaleDateString(locale);
};

export type StatusTone = "ok" | "busy" | "offline" | "attention";
/**
 * Indicator colour for a real status label. Only a settled label is green;
 * anything unrecognized asks for attention rather than implying success.
 */
export const statusTone = (label: string, attention = false): StatusTone => {
  const canonical = localizeMessage(label, "en");
  if (attention) {
    return "attention";
  }
  if (canonical.startsWith("Up to date")) {
    return "ok";
  }
  if (canonical.startsWith("Updating") || canonical.startsWith("Checking")) {
    return "busy";
  }
  return canonical === "Offline" || canonical.startsWith("Sign in")
    ? "offline"
    : "attention";
};
