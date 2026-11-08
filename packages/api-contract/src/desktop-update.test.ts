import { expect, test } from "bun:test";

import { updateStatusSchema } from "./desktop-update";

test("native update availability never accepts an executable URL from a client payload", () => {
  expect(
    updateStatusSchema.parse({
      phase: "available",
      version: "0.2.0",
      error: null,
    })
  ).toEqual({ phase: "available", version: "0.2.0", error: null });
  expect(
    updateStatusSchema.safeParse({
      phase: "available",
      version: "0.2.0",
      error: null,
      url: "https://instance.example/setup.exe",
    }).success
  ).toBe(false);
  expect(
    updateStatusSchema.safeParse({
      phase: "verified",
      version: null,
      error: null,
    }).success
  ).toBe(false);
});
