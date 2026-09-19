/**
 * PROTOTYPE (issue #9) — matching normalization agreed in issue #7.
 *
 * Normalization applies to queries and searchable values alike. It never
 * rewrites stored text and never changes tag or collection identity.
 */

const COMBINING_MARKS = /\p{Diacritic}/gu;
const WHITESPACE_RUN = /\s+/gu;

/**
 * Case-insensitive, accent-insensitive, sharp-s-folding comparison form.
 * Punctuation is preserved literally, so `C++` stays searchable as `C++`.
 */
export const normalize = (value: string): string =>
  value
    .toLowerCase()
    // Fold before decomposition: U+00DF has no canonical decomposition.
    .replaceAll("ß", "ss")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(WHITESPACE_RUN, " ")
    .trim();

/** Whitespace separates query terms; a blank query imposes no restriction. */
export const queryTerms = (query: string): string[] => {
  const normalized = normalize(query);
  return normalized === "" ? [] : normalized.split(" ");
};
