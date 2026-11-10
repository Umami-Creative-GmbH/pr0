import { accountTestServer, runAcceptance } from "./account-test-server";

// Keep feature journeys at their public controls and reuse one production build.
const journeys = [
  "accessibility",
  "legal-links",
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
// Runtime instance configuration, not a build variable: the same build serves both cases.
const legalLinks = {
  PR0_IMPRESSUM_URL: "https://operator.example/impressum",
  PR0_PRIVACY_URL: "https://operator.example/privacy",
};
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
  await server.startServer(legalLinks);
  await runAcceptance(
    [
      "bun",
      "test",
      "apps/web/tests/legal-links-browser.test.ts",
      "--timeout",
      "180000",
    ],
    legalLinks
  );
} finally {
  await server.cleanup();
}
