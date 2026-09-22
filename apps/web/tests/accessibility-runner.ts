import { accountTestServer, runAcceptance } from "./account-test-server";

// Keep feature journeys at their public controls and reuse one production build.
const journeys = [
  "accessibility",
  "collections",
  "tags",
  "organization-cleanup",
  "conflict-review",
  "prompts",
  "prompt-lifecycle",
  "prompt-deletion",
  "search",
  "full-search",
  "variables",
];
const server = accountTestServer("pr0-accessibility-63");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    ...journeys.map((name) => `apps/web/tests/${name}-browser.test.ts`),
    "--timeout",
    "180000",
  ]);
} finally {
  await server.cleanup();
}
