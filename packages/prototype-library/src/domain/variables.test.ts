import { expect, test } from "bun:test";

import { extractVariables, resolveVariables, splitContent } from "./variables";

test("extracts each variable once, in first-appearance order", () => {
  expect(
    extractVariables("Hi {{name}}, meet {{ other }} and {{name}}")
  ).toEqual(["name", "other"]);
});

test("finds no variables in ordinary prompt text", () => {
  expect(extractVariables("Plain text with { braces } and {{ }}")).toEqual([]);
});

test("splits content into literal and variable segments for highlighting", () => {
  expect(splitContent("Hi {{name}}!")).toEqual([
    { kind: "text", text: "Hi " },
    { kind: "variable", text: "{{name}}", name: "name" },
    { kind: "text", text: "!" },
  ]);
});

test("substitutes supplied values and keeps empty ones as placeholders", () => {
  const content = "Translate {{text}} into {{language}}.";
  expect(resolveVariables(content, { text: "Hallo", language: "" })).toBe(
    "Translate Hallo into {{language}}."
  );
  expect(resolveVariables(content, {})).toBe(content);
});

test("substitutes every occurrence of a repeated variable", () => {
  expect(resolveVariables("{{a}} and {{a}}", { a: "x" })).toBe("x and x");
});

test("preserves prompt content exactly, including whitespace", () => {
  const content = "  line one\n\tindented {{v}}  ";
  expect(resolveVariables(content, { v: "value" })).toBe(
    "  line one\n\tindented value  "
  );
});
