import { accountTestServer, runAcceptance } from "./account-test-server";
import { organizationRestartFixture } from "./organization-cleanup-restart";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";
import { tagOperation, tagDelta } from "./tag-fixture";

const server = accountTestServer("pr0-tags-34");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    ...(process.argv.slice(2).length
      ? process.argv.slice(2)
      : [
          "apps/web/tests/organization-cleanup-integration.test.ts",
          "apps/web/tests/organization-cleanup-browser.test.ts",
          "apps/web/tests/tags-integration.test.ts",
          "apps/web/tests/tags-browser.test.ts",
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
    const tag = tagOperation("Restart tag");
    const create = promptOperation();
    const envelope = {
      ...account.identity,
      operations: [tag, tagOperation("RESTART TAG"), create],
    };
    const receipt = await client.mutatePrompts(envelope);
    const assignments = {
      ...account.identity,
      operations: [tagDelta(create.promptId, "0", [tag.tagId])],
    };
    const assignmentReceipt = await client.mutatePrompts(assignments);
    await account.mutate([tagDelta(create.promptId, "0", [], [tag.tagId])]);
    const fixture = {
      Cookie: account.Cookie,
      envelope,
      receipt,
      assignments,
      assignmentReceipt,
      prompt: await client.getPrompt(create.promptId),
      snapshot: await client.getOrganization(),
    };
    const cleanupFixture = await organizationRestartFixture();
    await server.startServer();
    await runAcceptance(
      [
        "bun",
        "test",
        "apps/web/tests/tags-restart.test.ts",
        "apps/web/tests/organization-cleanup-restart.test.ts",
      ],
      {
        PR0_TAG_RESTART_FIXTURE: JSON.stringify(fixture),
        PR0_ORGANIZATION_RESTART_FIXTURE: JSON.stringify(cleanupFixture),
      }
    );
  }
} finally {
  await server.cleanup();
}
