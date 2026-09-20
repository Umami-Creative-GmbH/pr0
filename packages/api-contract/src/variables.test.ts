import { expect, test } from "bun:test";

import fixtures from "./variable-fixtures.json";
import validation from "./variable-validation-fixtures.json";
import { parseTemplate, substituteTemplate } from "./variables";

for (const fixture of fixtures) {
  test(`canonical tokenization and literal output: ${fixture.content}`, () => {
    const template = parseTemplate(fixture.content);
    expect(template.fields.map(({ name, type }) => [name, type])).toEqual(
      fixture.fields
    );
    const values = new Map(
      fixture.values.map(([name = "", value = ""]) => [name, value])
    );
    expect(substituteTemplate(template, values)).toEqual({
      ok: true,
      text: fixture.output,
    });
  });
}

for (const value of validation.acceptedNumbers) {
  test(`decimal text stays exact: ${value}`, () => {
    expect(
      substituteTemplate(parseTemplate("{{x|number}}"), new Map([["x", value]]))
    ).toEqual({ ok: true, text: value });
  });
}
for (const value of validation.rejectedNumbers) {
  test(`invalid decimal text is rejected: ${JSON.stringify(value)}`, () => {
    expect(
      substituteTemplate(parseTemplate("{{x|number}}"), new Map([["x", value]]))
        .ok
    ).toBe(false);
  });
}
for (const value of [
  ...validation.invalidStrings,
  ...validation.invalidUtf16Units.map((units) =>
    String.fromCodePoint(...units)
  ),
]) {
  test(`invalid string value is rejected: ${JSON.stringify(value)}`, () => {
    expect(
      substituteTemplate(parseTemplate("{{x}}"), new Map([["x", value]])).ok
    ).toBe(false);
  });
}
test("BOM is not pinned Unicode whitespace and valid surrounding whitespace stays exact", () => {
  expect(
    substituteTemplate(parseTemplate("{{x}}"), new Map([["x", "\uFEFF"]]))
  ).toEqual({ ok: true, text: "\uFEFF" });
});
test("repeated values and multibyte scalars respect inclusive byte limits without truncation", () => {
  const repeated = parseTemplate("{{x}}{{x}}");
  expect(
    substituteTemplate(repeated, new Map([["x", "a".repeat(131_072)]]))
  ).toEqual({ ok: true, text: "a".repeat(262_144) });
  expect(
    substituteTemplate(repeated, new Map([["x", "a".repeat(131_073)]])).ok
  ).toBe(false);
  const emoji = "😀".repeat(65_536);
  expect(
    substituteTemplate(parseTemplate("{{x}}"), new Map([["x", emoji]]))
  ).toEqual({ ok: true, text: emoji });
  expect(
    substituteTemplate(parseTemplate("{{x}}"), new Map([["x", `${emoji}😀`]]))
      .ok
  ).toBe(false);
  expect(
    substituteTemplate(parseTemplate(" {{x}}"), new Map([["x", emoji]])).ok
  ).toBe(false);
});

test("first appearance deduplicates case-sensitive names and aggregates number annotations", () => {
  const template = parseTemplate(
    "Hello {{name}}; {{ name }} meets {{Name}}. {{name|number}}"
  );
  expect(template.fields).toEqual([
    { name: "name", type: "number" },
    { name: "Name", type: "string" },
  ]);
  expect(
    substituteTemplate(
      template,
      new Map([
        ["name", "+02.50"],
        ["Name", "Keep {{other}} and $&"],
      ])
    )
  ).toEqual({
    ok: true,
    text: "Hello +02.50; +02.50 meets Keep {{other}} and $&. +02.50",
  });
});

for (const fixture of validation.bounds) {
  test(`shared byte bound: ${fixture.content}, ${fixture.repeat} repetitions`, () => {
    const result = substituteTemplate(
      parseTemplate(fixture.content),
      new Map([["x", fixture.unit.repeat(fixture.repeat)]])
    );
    expect(result.ok).toBe(fixture.ok);
  });
}
