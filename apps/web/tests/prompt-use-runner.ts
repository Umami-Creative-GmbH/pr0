import type { UsePrompt } from "@pr0/api-contract/prompts";

import { accountTestServer, runAcceptance } from "./account-test-server";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";

const server = accountTestServer("pr0-prompt-use-38");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/prompt-copy-browser.test.ts",
    "apps/web/tests/prompt-copy-webkit.test.ts",
    "apps/web/tests/prompt-use-integration.test.ts",
    "apps/web/tests/full-search-integration.test.ts",
    "apps/web/tests/full-search-browser.test.ts",
    "--timeout",
    "120000",
  ]);
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const use: UsePrompt = {
    kind: "prompt.use",
    operationId: crypto.randomUUID(),
    promptId: create.promptId,
    baseRevision: "0",
    dependsOn: [],
    occurredAt: "2099-01-01T00:00:00.000Z",
  };
  const envelope = { ...account.identity, operations: [use] };
  const receipt = await client.mutatePrompts(envelope);
  const fixture = {
    Cookie: account.Cookie,
    envelope,
    receipt,
    prompt: await client.getPrompt(create.promptId),
  };
  await server.startServer();
  await runAcceptance(
    ["bun", "test", "apps/web/tests/prompt-use-restart.test.ts"],
    { PR0_USE_RESTART_FIXTURE: JSON.stringify(fixture) }
  );
} finally {
  await server.cleanup();
}
