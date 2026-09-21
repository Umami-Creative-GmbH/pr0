import { expect, test } from "bun:test";

import { organizationIdentity } from "./organization";
import fixtures from "./organization-native-fixtures.json";

test("organization identity agrees with the native command conformance cases", () => {
  for (const fixture of fixtures) {
    expect(
      organizationIdentity(fixture.first) ===
        organizationIdentity(fixture.second)
    ).toBe(fixture.same);
  }
});
