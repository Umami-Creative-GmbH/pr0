import assert from "node:assert/strict";

import { changeStatusSchema } from "@pr0/api-contract/changes";
import { localPromptSchema } from "@pr0/api-contract/local-prompts";
import { mutationResponseSchema } from "@pr0/api-contract/prompts";
import type { Page } from "playwright";
import { z } from "zod";

import type { NativeArgs } from "./local-native-worker";
import { promptOperation } from "./prompt-fixture";

export const verifyNativeChanges = async ({
  commands,
  page,
  origin,
}: {
  commands: ((
    command: string,
    args?: NativeArgs
  ) => Promise<z.infer<ReturnType<typeof z.json>>>)[];
  page: Page;
  origin: string;
}) => {
  await Promise.all(
    commands.map(async (command) => {
      const initial = z
        .object({ complete: z.boolean() })
        .parse(await command("library_download"));
      assert.equal(initial.complete, true);
      const checked = changeStatusSchema.parse(
        await command("library_changes")
      );
      assert.equal(checked.error, null);
      assert.ok(checked.lastCheckedAt);
      const started = performance.now();
      const interrupted = changeStatusSchema.parse(
        await command("library_interrupt_changes")
      );
      assert.equal(interrupted.error, null);
      assert.equal(interrupted.lastCheckedAt, checked.lastCheckedAt);
      assert.ok(performance.now() - started < 2000);
    })
  );
  const response = await page.request.get(`${origin}/api/v1/library`);
  const identity = z
    .object({
      instance: z.object({ id: z.string() }),
      account: z.object({ id: z.string() }),
      epoch: z.string(),
    })
    .parse(await response.json());
  const operation = promptOperation({
    title: "Live HTTPS prompt",
    description: "",
    content: "Received without a replacement snapshot",
  });
  const waiting = Promise.all(
    commands.map((command) => command("library_poll_changes"))
  );
  await Bun.sleep(200);
  const started = performance.now();
  const mutation = await page.request.post(`${origin}/api/v1/sync/mutations`, {
    headers: { Origin: origin },
    data: {
      protocolVersion: 1,
      instanceId: identity.instance.id,
      accountId: identity.account.id,
      epoch: identity.epoch,
      installationId: crypto.randomUUID(),
      operations: [operation],
    },
  });
  assert.equal(
    mutationResponseSchema.parse(await mutation.json()).results[0]?.status,
    "accepted"
  );
  for (const value of await waiting) {
    assert.equal(changeStatusSchema.parse(value).error, null);
  }
  const prompts = await Promise.all(
    commands.map(async (command) =>
      localPromptSchema.parse(
        await command("library_editor", { id: operation.promptId })
      )
    )
  );
  for (const prompt of prompts) {
    assert.equal(
      prompt.prompt.content,
      "Received without a replacement snapshot"
    );
  }
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 5000);
  process.stdout.write(
    `LIVE_NATIVE ${JSON.stringify({ elapsedMs, clients: prompts.length, revisions: prompts.map((prompt) => prompt.prompt.revision) })}\n`
  );
};
