/**
 * PROTOTYPE (issue #9) — `{{variable}}` substitution.
 *
 * NOTE: issue #1 currently lists variable substitution as OUT of MVP scope
 * ("variable-like text remains ordinary prompt content initially"). It is
 * prototyped here because the design explores it; the decision on whether to
 * pull it into scope belongs to the human on issue #9.
 */

const VARIABLE_PATTERN = /\{\{\s*(?<name>[a-zA-Z0-9_]+)\s*\}\}/gu;
const VARIABLE_SPLIT_PATTERN = /(?<token>\{\{\s*[a-zA-Z0-9_]+\s*\}\})/u;
const VARIABLE_EXACT_PATTERN = /^\{\{\s*(?<name>[a-zA-Z0-9_]+)\s*\}\}$/u;

export type ContentSegment =
  | { kind: "text"; text: string }
  | { kind: "variable"; text: string; name: string };

/** Distinct variable names, in the order they first appear. */
export const extractVariables = (content: string): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const name = match.groups?.name;
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
};

/** Segments the content so variables can be highlighted in place. */
export const splitContent = (content: string): ContentSegment[] =>
  content
    .split(VARIABLE_SPLIT_PATTERN)
    .filter((part) => part !== "")
    .map((part) => {
      const name = VARIABLE_EXACT_PATTERN.exec(part)?.groups?.name;
      return name === undefined
        ? ({ kind: "text", text: part } as const)
        : ({ kind: "variable", text: part, name } as const);
    });

/** Empty or missing values are left as their original placeholder token. */
export const resolveVariables = (
  content: string,
  values: Record<string, string>
): string =>
  content.replace(VARIABLE_PATTERN, (token, ...args: unknown[]) => {
    // SAFETY: the pattern declares a single named group, so the final
    // argument to a String#replace callback is always its groups object.
    const groups = args.at(-1) as { name: string };
    return values[groups.name] || token;
  });
