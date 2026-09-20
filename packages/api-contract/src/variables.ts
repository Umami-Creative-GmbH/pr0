import { promptLimits, trimPromptText, utf8Bytes } from "./prompts";

export interface PromptVariable {
  name: string;
  type: "string" | "number";
}
type Segment = { text: string } | { name: string };
export interface PromptTemplate {
  fields: PromptVariable[];
  segments: Segment[];
}
const placeholder =
  /^\{\{[ \t]*(?<name>[A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:\|[ \t]*(?<type>string|number)[ \t]*)?\}\}$/u;
const decimal = /^[ \t]*[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)[ \t]*$/u;
// oxlint-disable-next-line eslint/no-control-regex -- Reject NUL and lone surrogates, but permit valid surrogate pairs.
const invalidScalar = /[\uD800-\uDFFF\u0000]/u;

// Consume a whole candidate, including nested braces and surplus closing braces.
const candidateEnd = (text: string, start: number) => {
  let balance = 0;
  let end = start;
  while (end < text.length && text[end] !== "\r" && text[end] !== "\n") {
    if (text[end] === "}") {
      do {
        balance -= 1;
        end += 1;
      } while (text[end] === "}");
      if (balance <= 0) {
        break;
      }
    } else {
      if (text[end] === "{") {
        balance += 1;
      }
      end += 1;
    }
  }
  return end;
};

export const parseTemplate = (content: string): PromptTemplate => {
  const fields = new Map<string, PromptVariable>();
  const segments: Segment[] = [];
  let literalStart = 0;
  let cursor = 0;
  while (cursor < content.length) {
    if (content[cursor] !== "{" || content[cursor + 1] !== "{") {
      cursor += 1;
      continue;
    }
    const end = candidateEnd(content, cursor);
    const token = content.slice(cursor, end);
    const match = placeholder.exec(token);
    const name = match?.groups?.name;
    if (name) {
      const escaped = content[cursor - 1] === "\\";
      segments.push({
        text: content.slice(literalStart, cursor - (escaped ? 1 : 0)),
      });
      if (escaped) {
        segments.push({ text: token });
      } else {
        const type = match?.groups?.type === "number" ? "number" : "string";
        const previous = fields.get(name);
        fields.set(name, {
          name,
          type: previous?.type === "number" ? "number" : type,
        });
        segments.push({ name });
      }
      literalStart = end;
    }
    cursor = end;
  }
  segments.push({ text: content.slice(literalStart) });
  return { fields: [...fields.values()], segments };
};

export const variableError = (
  field: PromptVariable,
  value: string
): string | undefined => {
  if (invalidScalar.test(value)) {
    return "Use valid Unicode text without NUL characters.";
  }
  if (trimPromptText(value).length === 0) {
    return "Enter a nonblank value.";
  }
  if (utf8Bytes(value) > promptLimits.contentBytes) {
    return "Value must be at most 256 KiB of UTF-8 text.";
  }
  if (field.type === "number" && !decimal.test(value)) {
    return "Enter decimal text, such as -3 or +02.50, without exponents or line breaks.";
  }
};

export type SubstitutionResult =
  | { ok: true; text: string }
  | { ok: false; fields: Map<string, string>; message: string };

export const substituteTemplate = (
  template: PromptTemplate,
  values: ReadonlyMap<string, string>
): SubstitutionResult => {
  const errors = new Map<string, string>();
  for (const field of template.fields) {
    const error = variableError(field, values.get(field.name) ?? "");
    if (error) {
      errors.set(field.name, error);
    }
  }
  if (errors.size > 0) {
    return { ok: false, fields: errors, message: "Check the variable values." };
  }
  const parts: string[] = [];
  let bytes = 0;
  for (const segment of template.segments) {
    const text =
      "text" in segment ? segment.text : (values.get(segment.name) ?? "");
    bytes += utf8Bytes(text);
    if (bytes > promptLimits.contentBytes) {
      return {
        ok: false,
        fields: errors,
        message:
          "Combined output must be at most 256 KiB of UTF-8 text. Nothing was copied.",
      };
    }
    parts.push(text);
  }
  return { ok: true, text: parts.join("") };
};
