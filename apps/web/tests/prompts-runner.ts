import { accountTestServer, runAcceptance } from "./account-test-server";
import { promptBrowser, promptOperation } from "./prompt-fixture";

const server = accountTestServer("pr0-prompts-29");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/prompts-integration.test.ts",
    "apps/web/tests/prompts-capacity.test.ts",
    "apps/web/tests/prompts-browser.test.ts",
    "--timeout",
    "60000",
  ]);
  const browser = await promptBrowser();
  const operation = promptOperation({
    title: "Restart persistence",
    description: "Server dates and receipts survive",
    content: "  Durable 🌍\n\tExact text\n ",
  });
  const response = await browser.mutate([operation]);
  const detail = await browser.get(`/${operation.promptId}`);
  const fixture = {
    Cookie: browser.Cookie,
    envelope: { ...browser.identity, operations: [operation] },
    id: operation.promptId,
    receipt: await response.json(),
    detail: await detail.json(),
  };
  await server.startServer();
  await runAcceptance(
    ["bun", "test", "apps/web/tests/prompts-restart.test.ts"],
    { PR0_PROMPT_RESTART_FIXTURE: JSON.stringify(fixture) }
  );
} finally {
  await server.cleanup();
}
