import type { DuplicatePrompt } from "@pr0/api-contract/prompts";

import { accountTestServer, runAcceptance } from "./account-test-server";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
} from "./prompt-fixture";

const server = accountTestServer("pr0-prompt-lifecycle-31");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    ...(process.argv.slice(2).length
      ? process.argv.slice(2)
      : [
          "apps/web/tests/prompt-lifecycle-integration.test.ts",
          "apps/web/tests/prompt-lifecycle-browser.test.ts",
          "apps/web/tests/prompt-edits-integration.test.ts",
          "apps/web/tests/prompt-edits-browser.test.ts",
          "apps/web/tests/prompts-integration.test.ts",
          "apps/web/tests/prompts-capacity.test.ts",
          "apps/web/tests/prompts-browser.test.ts",
        ]),
    "--timeout",
    "60000",
  ]);
  if (!process.argv.slice(2).length) {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const create = promptOperation({
      title: "🌍".repeat(200),
      description: "",
      content: "Retain across restart",
    });
    await account.mutate([create]);
    const source = await client.getPrompt(create.promptId);
    await account.mutate([
      promptState(source, "favorite", true),
      promptState(source, "archived", true),
    ]);
    const duplicate: DuplicatePrompt = {
      ...promptOperation(create.desired),
      kind: "prompt.duplicate",
      sourceId: source.id,
    };
    const envelope = { ...account.identity, operations: [duplicate] };
    const receipt = await client.mutatePrompts(envelope);
    const fixture = {
      Cookie: account.Cookie,
      envelope,
      receipt,
      source: await client.getPrompt(source.id),
      copy: await client.getPrompt(duplicate.promptId),
    };
    await server.startServer();
    await runAcceptance(
      ["bun", "test", "apps/web/tests/prompt-lifecycle-restart.test.ts"],
      { PR0_LIFECYCLE_RESTART_FIXTURE: JSON.stringify(fixture) }
    );
  }
} finally {
  await server.cleanup();
}
