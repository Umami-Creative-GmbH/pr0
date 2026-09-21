import { expect, test } from "bun:test";

import { desktopCopySchema, desktopCopyResultSchema } from "./desktop-copy";

test("desktop copy accepts transient values but acknowledgements contain identity only", () => {
  const origin = {
    instanceId: "11111111-1111-4111-8111-111111111111",
    accountId: "22222222-2222-4222-8222-222222222222",
    generation: 1,
    promptId: "33333333-3333-4333-8333-333333333333",
  };
  const request = { ...origin, template: "{{x}}", values: [["x", "private"]] };
  expect(desktopCopySchema.safeParse(request).success).toBe(true);
  expect(
    desktopCopyResultSchema.safeParse({ origin, usageSaved: true }).success
  ).toBe(true);
  expect(
    desktopCopyResultSchema.safeParse({ origin: request, usageSaved: true })
      .success
  ).toBe(false);
});
