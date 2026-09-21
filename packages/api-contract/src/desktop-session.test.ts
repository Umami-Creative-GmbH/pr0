import { expect, test } from "bun:test";

import { signOutRequestSchema } from "./desktop-session";
import fixtures from "./transition-fixtures.json";

for (const fixture of fixtures) {
  test(`native sign-out contract: ${fixture.name}`, () => {
    expect(signOutRequestSchema.safeParse(fixture.request).success).toBe(
      fixture.valid
    );
  });
}
