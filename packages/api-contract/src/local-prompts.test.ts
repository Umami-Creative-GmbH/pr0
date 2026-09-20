import { expect, test } from "bun:test";

import fixtures from "./local-save-fixtures.json";
import { promptTextSchema } from "./prompts";

for (const fixture of fixtures) {
  test(`shared native/REST prompt validation: ${fixture.field}, ${fixture.repeat} repetitions of ${JSON.stringify(fixture.value)}`, () => {
    const value = fixture.invalidScalar
      ? String.fromCodePoint(fixture.invalidScalar)
      : fixture.value.repeat(fixture.repeat);
    const input = {
      title: "Title",
      description: "",
      content: "Content",
      [fixture.field]: value,
    };
    expect(promptTextSchema.safeParse(input).success).toBe(fixture.valid);
  });
}
