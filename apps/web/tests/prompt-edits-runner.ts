import { accountTestServer, runAcceptance } from "./account-test-server";
import {
  promptBrowser,
  promptClient,
  promptEdit,
  promptOperation,
} from "./prompt-fixture";

const server = accountTestServer("pr0-prompt-edits-30");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    ...(process.argv.slice(2).length
      ? process.argv.slice(2)
      : [
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
    await client.mutatePrompts({ ...account.identity, operations: [create] });
    const base = await client.getPrompt(create.promptId);
    await client.mutatePrompts({
      ...account.identity,
      operations: [promptEdit(base, { ...create.desired, content: "A" })],
    });
    const envelope = {
      ...account.identity,
      operations: [
        promptEdit(base, {
          ...create.desired,
          title: "🌍".repeat(200),
          content: "B",
        }),
      ],
    };
    const receipt = await client.mutatePrompts(envelope);
    const [accepted] = receipt.results;
    if (
      accepted?.status !== "accepted" ||
      !("promptId" in accepted) ||
      !accepted.conflict
    ) {
      throw new Error("Expected conflict before restart");
    }
    const fixture = {
      Cookie: account.Cookie,
      envelope,
      receipt,
      copy: await client.getPrompt(accepted.conflict.copyId),
      notices: await client.getConflicts(),
    };
    await server.startServer();
    await runAcceptance(
      ["bun", "test", "apps/web/tests/prompt-edits-restart.test.ts"],
      { PR0_EDIT_RESTART_FIXTURE: JSON.stringify(fixture) }
    );
  }
} finally {
  await server.cleanup();
}
