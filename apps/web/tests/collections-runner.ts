import { accountTestServer, runAcceptance } from "./account-test-server";
import { collectionOperation, assignCollection } from "./collection-fixture";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";

const server = accountTestServer("pr0-collections-33");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    ...(process.argv.slice(2).length
      ? process.argv.slice(2)
      : [
          "apps/web/tests/collections-integration.test.ts",
          "apps/web/tests/collections-browser.test.ts",
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
    const collection = collectionOperation("Restart collection");
    const create = promptOperation();
    const envelope = { ...account.identity, operations: [collection, create] };
    const receipt = await client.mutatePrompts(envelope);
    const source = await client.getPrompt(create.promptId);
    const assignments = {
      ...account.identity,
      operations: [assignCollection(source, collection.collectionId)],
    };
    const assignmentReceipt = await client.mutatePrompts(assignments);
    await account.mutate([
      collectionOperation("Renamed before restart", collection.collectionId),
    ]);
    const fixture = {
      Cookie: account.Cookie,
      envelope,
      receipt,
      assignments,
      assignmentReceipt,
      prompt: await client.getPrompt(source.id),
      snapshot: await client.getOrganization(),
    };
    await server.startServer();
    await runAcceptance(
      ["bun", "test", "apps/web/tests/collections-restart.test.ts"],
      { PR0_COLLECTION_RESTART_FIXTURE: JSON.stringify(fixture) }
    );
  }
} finally {
  await server.cleanup();
}
