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
export const relativeTime = (iso: string, now: number) => {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return "";
  }
  const elapsed = Math.max(0, now - at);
  if (elapsed < minute) {
    return "just now";
  }
  if (elapsed < hour) {
    return `${Math.floor(elapsed / minute)} min ago`;
  }
  if (elapsed < day) {
    return `${Math.floor(elapsed / hour)} h ago`;
  }
  const days = Math.floor(elapsed / day);
  if (days === 1) {
    return "yesterday";
  }
  return days < recentDays
    ? `${days} days ago`
    : new Date(at).toLocaleDateString();
};

export type StatusTone = "ok" | "busy" | "offline" | "attention";
/**
 * Indicator colour for a real status label. Only a settled label is green;
 * anything unrecognized asks for attention rather than implying success.
 */
export const statusTone = (label: string, attention = false): StatusTone => {
  if (attention) {
    return "attention";
  }
  if (label.startsWith("Up to date")) {
    return "ok";
  }
  if (label.startsWith("Updating") || label.startsWith("Checking")) {
    return "busy";
  }
  return label === "Offline" || label.startsWith("Sign in")
    ? "offline"
    : "attention";
};
