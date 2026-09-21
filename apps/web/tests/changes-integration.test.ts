// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Ordered mutation pages and periodic observation of the real retention worker.
import { expect, test } from "bun:test";

import { createChangeClient } from "@pr0/api-client/changes";
import { SQL } from "bun";

import { origin } from "./http-fixture";
import { promptBrowser, promptOperation } from "./prompt-fixture";

test("a waiting web session receives a committed prompt in under five seconds and can replay the page", async () => {
  const account = await promptBrowser();
  const client = createChangeClient(origin, account.identity, (url, init) =>
    fetch(url, { ...init, headers: { Cookie: account.Cookie } })
  );
  const checkpoint = await client.poll({ wait: 0 });
  const waiting = client.poll({ cursor: checkpoint.cursor });
  const operation = promptOperation({
    title: "Arrives live",
    description: "",
    content: "Exact new content",
  });
  const start = performance.now();
  const response = await account.mutate([operation]);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    results: [{ status: "accepted" }],
  });
  const page = await waiting;
  expect(performance.now() - start).toBeLessThan(5000);
  expect(page.changes[0]?.prompts[0]).toMatchObject({
    id: operation.promptId,
    content: "Exact new content",
  });
  expect(page.hasMore).toBe(false);
  expect(await client.poll({ cursor: checkpoint.cursor, wait: 0 })).toEqual(
    page
  );
});

test("bounded pages keep complete events, catch changes missed before polling, and reject foreign or expired checkpoints", async () => {
  const account = await promptBrowser();
  const client = createChangeClient(origin, account.identity, (url, init) =>
    fetch(url, { ...init, headers: { Cookie: account.Cookie } })
  );
  const checkpoint = await client.poll({ wait: 0 });
  const operations = Array.from({ length: 20 }, (_, index) =>
    promptOperation({
      title: `Large ${index}`,
      description: "",
      content: "x".repeat(262_144),
    })
  );
  for (const batch of [operations.slice(0, 10), operations.slice(10)]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Separate bounded requests precede catch-up.
    const result = await account.mutate(batch);
    // oxlint-disable-next-line eslint/no-await-in-loop -- Validate the real mutation response before proceeding.
    expect(await result.json()).toMatchObject({
      results: batch.map(() => ({ status: "accepted" })),
    });
  }
  const first = await client.poll({ cursor: checkpoint.cursor, wait: 0 });
  expect(first.hasMore).toBe(true);
  expect(
    new TextEncoder().encode(JSON.stringify(first)).byteLength
  ).toBeLessThanOrEqual(4_194_304);
  const second = await client.poll({ cursor: first.cursor, wait: 0 });
  expect(second.hasMore).toBe(false);
  expect([...first.changes, ...second.changes]).toHaveLength(20);
  const foreign = await promptBrowser();
  const forbidden = await fetch(
    `${origin}/api/v1/sync/changes?cursor=${encodeURIComponent(checkpoint.cursor)}&wait=0`,
    { headers: { Cookie: foreign.Cookie } }
  );
  expect(forbidden.status).toBe(400);
  await expect(
    client.poll({ after: "0", epoch: crypto.randomUUID(), wait: 0 })
  ).rejects.toMatchObject({ detail: { code: "snapshot_required" } });
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  try {
    // Fixture the external retention boundary; assertions stay at public REST.
    await sql`UPDATE library_change SET accepted_at=clock_timestamp()-interval '91 days' WHERE account_id=${account.identity.accountId}`;
    await expect(
      client.poll({ cursor: checkpoint.cursor, wait: 0 })
    ).rejects.toMatchObject({ detail: { code: "snapshot_required" } });
    // Observe autonomous retention without another mutation from this account.
    let retained = true;
    for (let attempt = 0; attempt < 15 && retained; attempt += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Observe bounded operational pruning at its real interval.
      await Bun.sleep(1000);
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Read the disposable database's physical retention boundary.
      const [row] =
        await sql`SELECT EXISTS(SELECT 1 FROM library_change WHERE account_id=${account.identity.accountId}) AS retained`;
      ({ retained } = row);
    }
    expect(retained).toBe(false);
  } finally {
    await sql.close();
  }
});

test("an idle poll completes its 25-second wait without manufacturing a change", async () => {
  const account = await promptBrowser();
  const client = createChangeClient(origin, account.identity, (url, init) =>
    fetch(url, { ...init, headers: { Cookie: account.Cookie } })
  );
  const checkpoint = await client.poll({ wait: 0 });
  const started = performance.now();
  const checked = await client.poll({ cursor: checkpoint.cursor });
  const elapsed = performance.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(24_500);
  expect(elapsed).toBeLessThan(30_000);
  expect(checked.changes).toEqual([]);
  expect(checked.revision).toBe(checkpoint.revision);
});
