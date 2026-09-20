import { accountTestServer, runAcceptance } from "./account-test-server";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptDeletion,
  promptEdit,
} from "./prompt-fixture";

const server = accountTestServer("pr0-prompt-deletion-32");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    ...(process.argv.slice(2).length
      ? process.argv.slice(2)
      : [
          "apps/web/tests/prompt-deletion-integration.test.ts",
          "apps/web/tests/prompt-deletion-browser.test.ts",
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
    const create = promptOperation();
    await account.mutate([create]);
    const source = await client.getPrompt(create.promptId);
    await account.mutate([
      promptEdit(source, {
        ...create.desired,
        description: "Unseen before restart",
      }),
    ]);
    const envelope = {
      ...account.identity,
      operations: [promptDeletion(source)],
    };
    const receipt = await client.mutatePrompts(envelope);
    const [result] = receipt.results;
    if (result?.status !== "accepted" || !result.conflict) {
      throw new Error("Expected preserved copy");
    }
    const fixture = {
      Cookie: account.Cookie,
      envelope,
      receipt,
      sourceId: source.id,
      copy: await client.getPrompt(result.conflict.copyId),
      notices: await client.getConflicts(),
      page: await client.getPrompts(),
    };
    await server.startServer();
    await runAcceptance(
      ["bun", "test", "apps/web/tests/prompt-deletion-restart.test.ts"],
      { PR0_DELETE_RESTART_FIXTURE: JSON.stringify(fixture) }
    );
  }
} finally {
  await server.cleanup();
}
