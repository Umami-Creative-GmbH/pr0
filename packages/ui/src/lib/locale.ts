export type Locale = "en" | "de";
export type LanguagePreference = Locale | "system";

const storageKey = "pr0.language";
const changeEvent = "pr0-language";
let temporaryPreference: LanguagePreference | undefined;

export const languagePreference = (): LanguagePreference => {
  if (temporaryPreference) {
    return temporaryPreference;
  }
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === "en" || stored === "de" ? stored : "system";
  } catch {
    return "system";
  }
};

export const currentLocale = (): Locale => {
  if (typeof window === "undefined") {
    return "en";
  }
  const preference = languagePreference();
  if (preference !== "system") {
    return preference;
  }
  const language = navigator.language ?? "en";
  return language.toLowerCase().split(/[-_]/u)[0] === "de" ? "de" : "en";
};

export const setLanguagePreference = (preference: LanguagePreference) => {
  temporaryPreference = preference;
  try {
    if (preference === "system") {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, preference);
    }
    temporaryPreference = undefined;
  } catch {
    // Like theme, the setting remains usable when device storage is disabled.
  }
  window.dispatchEvent(new Event(changeEvent));
};

export const subscribeLanguage = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener("languagechange", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("languagechange", listener);
    window.removeEventListener(changeEvent, listener);
  };
};

export const serverLocale = (): Locale => "en";
export const serverLanguagePreference = (): LanguagePreference => "system";
