import path from "node:path";

import { runAcceptance } from "./account-test-server";
import type { accountTestServer } from "./account-test-server";
import {
  promptBrowser,
  promptClient,
  promptEdit,
  promptOperation,
} from "./prompt-fixture";

export const verifySearchRecovery = async (
  server: ReturnType<typeof accountTestServer>
) => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const operation = promptOperation({
    title: "Recovery",
    description: "",
    content: "before",
  });
  await account.mutate([operation]);
  await client.getPrompts({ query: "before" });
  const base = await client.getPrompt(operation.promptId);
  const edit = promptEdit(base, {
    title: base.title,
    description: "",
    content: "committed after indexing",
  });
  const receipt = await client.mutatePrompts({
    ...account.identity,
    operations: [edit],
  });
  const directory = path.resolve(import.meta.dir, "../.data/search");
  const fault = path.resolve(
    import.meta.dir,
    `../../../.scratch/search-fault-${crypto.randomUUID()}`
  );
  await Bun.write(fault, "A file cannot be opened as an index directory.");
  await server.startServer({ PR0_SEARCH_DIRECTORY: fault });
  const verify = (phase: string) =>
    runAcceptance(["bun", "test", "apps/web/tests/search-recovery.test.ts"], {
      PR0_SEARCH_RECOVERY_FIXTURE: JSON.stringify({
        Cookie: account.Cookie,
        id: operation.promptId,
        envelope: { ...account.identity, operations: [edit] },
        receipt,
        phase,
      }),
    });
  await verify("unavailable");
  await server.startServer({ PR0_SEARCH_DIRECTORY: directory });
  await verify("caught-up");
  await server.startServer({ PR0_SEARCH_DIRECTORY: directory });
  await verify("reopened");
  const filename = path.join(
    directory,
    `${account.identity.instanceId}-${account.identity.accountId}.sqlite`
  );
  if (path.dirname(filename) !== directory) {
    throw new Error("Unexpected derived index path");
  }
  await Bun.write(filename, "corrupt derived index fixture");
  await verify("rebuilt");
  await Bun.write(
    path.resolve(
      import.meta.dir,
      "../../../docs/validation/search-36-recovery.json"
    ),
    `${JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        committedMutationSurvivesIndexFailure: true,
        identicalReceiptReplay: true,
        explicitPreparationState: true,
        persistedCheckpointCatchUp: true,
        compatibleRestartIndexesZeroRows: true,
        corruptionRebuildPreservesCanonicalText: true,
      },
      null,
      2
    )}\n`
  );
};
