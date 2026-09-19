/** PROTOTYPE (issue #9) — locale-aware date presentation. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["month", MONTH],
  ["week", WEEK],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
];

/** "vor 2 Tagen" / "2 days ago", falling back to "jetzt" / "now". */
export const formatRelative = (
  timestamp: number,
  now: number,
  locale: string
): string => {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const elapsed = timestamp - now;
  const magnitude = Math.abs(elapsed);

  for (const [unit, size] of UNITS) {
    if (magnitude >= size) {
      return formatter.format(Math.round(elapsed / size), unit);
    }
  }
  return formatter.format(0, "second");
};

/** "12.03.2026" / "3/12/2026". */
export const formatDate = (timestamp: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(
    new Date(timestamp)
  );
