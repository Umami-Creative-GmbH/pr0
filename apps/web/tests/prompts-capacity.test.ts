import { expect, test } from "bun:test";

import {
  mutationResponseSchema,
  promptPageSchema,
} from "@pr0/api-contract/prompts";

import { seedCapacity } from "./prompt-capacity-fixture";
import { promptBrowser, promptOperation } from "./prompt-fixture";

for (const resource of ["promptCount", "textBytes"] as const) {
  test(`concurrent REST creates cannot exceed ${resource}; refusal has no partial effect`, async () => {
    const browser = await promptBrowser();
    await seedCapacity(browser.identity, resource);
    const operations = [
      promptOperation({ title: "p", description: "", content: "x" }),
      promptOperation({ title: "p", description: "", content: "x" }),
    ];
    const replies = await Promise.all(
      operations.map((operation) => browser.mutate([operation]))
    );
    const bodies = await Promise.all(
      replies.map((response) => response.json())
    );
    const results = bodies.flatMap(
      (body) => mutationResponseSchema.parse(body).results
    );
    expect(
      results.filter((result) => result.status === "accepted")
    ).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused).toMatchObject({
      status: "rejected",
      error: { code: "quota_exceeded", resource },
    });
    const response = await browser.get("");
    const page = promptPageSchema.parse(await response.json());
    expect(page.usage[resource]).toBe(
      resource === "promptCount" ? 10_000 : 104_857_600
    );
    expect(page.revision).toBe(resource === "promptCount" ? "10000" : "401");
    const refusedOperation = operations.find(
      (operation) =>
        operation.operationId ===
        (refused?.status === "rejected" ? refused.error.operationId : "")
    );
    if (!refusedOperation) {
      throw new Error("Expected one refused operation");
    }
    const absent = await browser.get(`/${refusedOperation.promptId}`);
    expect(absent.status).toBe(404);
    const retry = await browser.mutate([refusedOperation]);
    expect(await retry.json()).toMatchObject({
      results: [{ status: "rejected", error: { code: "quota_exceeded" } }],
    });
  }, 30_000);
}
