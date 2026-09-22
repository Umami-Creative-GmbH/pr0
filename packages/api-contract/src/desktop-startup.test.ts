import { expect, test } from "bun:test";

import { startupStatusSchema } from "./desktop-resident";

test("startup status distinguishes external disablement and unknown registration", () => {
  expect(
    startupStatusSchema.parse({ state: "disabled_by_windows", offer: false })
  ).toEqual({ state: "disabled_by_windows", offer: false });
  expect(
    startupStatusSchema.safeParse({ state: "enabled", offer: "false" }).success
  ).toBe(false);
  expect(
    startupStatusSchema.safeParse({ state: "unknown", offer: false }).success
  ).toBe(false);
});
