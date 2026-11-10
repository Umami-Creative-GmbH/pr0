// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Reconcile and verify each retained account in order.
import assert from "node:assert/strict";

import { promptSchema } from "@pr0/api-contract/prompts";
import { z } from "zod";

import { measureCapacityCatchUp } from "./capacity-catch-up";
import { capacityId } from "./capacity-corpus";
import { resumeCapacityService } from "./capacity-service-resume";
import { capacityStorage } from "./capacity-storage";
import { acknowledgedCapacityUses } from "./capacity-usage";

const source = z
  .object({
    samples: z.array(
      z.object({
        account: z.number(),
        number: z.number(),
        status: z.number(),
        error: z.string().nullable(),
      })
    ),
  })
  .parse(await Bun.file("docs/evidence/issue-65-service.json").json());
const [retainedReport] = process.argv.slice(2);
assert.ok(retainedReport, "Pass the prepared retained fixture report");
const instance = await resumeCapacityService(retainedReport, true);
interface PostLoadEvidence {
  recordedAt: string;
  classification: string;
  releaseCriteriaMet: false;
  failure: string;
  readinessFailure: string;
  catchUp?: Awaited<ReturnType<typeof measureCapacityCatchUp>>;
  storage?: Awaited<ReturnType<typeof capacityStorage>>;
  verification: { account: number; expected: number; actual: number }[];
}
const evidence: PostLoadEvidence = {
  recordedAt: new Date().toISOString(),
  releaseCriteriaMet: false,
  classification:
    "Separate post-load supplement on the retained fixture. Account 18 receives 1000 fresh creates; account 19 retains the original partial attempt. Timed fixed-arrival evidence is unchanged. This is not native queued-edit or network-shaped validation.",
  failure: "",
  readinessFailure: "",
  verification: [],
};
try {
  const accounts: { cookie: string; number: number }[] = [];
  for (let number = 0; number < 20; number += 1) {
    accounts.push({
      number,
      cookie: await instance.login(`capacity-${number}@example.test`),
    });
  }
  const previous = accounts.at(19);
  const target = accounts.at(18);
  assert.ok(previous && target);
  const deadline = performance.now() + 120_000;
  while (true) {
    const response = await instance.request(
      "/api/v1/library/prompts?query=Catch-up&limit=100",
      undefined,
      previous.cookie
    );
    await response.body?.cancel();
    if (response.ok) {
      break;
    }
    assert.ok(response.status === 503 && performance.now() < deadline);
    await Bun.sleep(1000);
  }
  evidence.catchUp = await measureCapacityCatchUp(instance, target.cookie);
  process.stdout.write(
    `REST supplement acknowledged ${evidence.catchUp.acknowledged} operations in ${evidence.catchUp.elapsedMs} ms.\n`
  );
  await instance.compose("restart", "web");
  try {
    await instance.ready();
  } catch (error) {
    evidence.readinessFailure = String(error);
  }
  for (const account of accounts) {
    const response = await instance.request(
      `/api/v1/library/prompts/${capacityId(1)}`,
      undefined,
      account.cookie
    );
    assert.equal(response.status, 200);
    const prompt = promptSchema.parse(await response.json());
    const expected = acknowledgedCapacityUses(source.samples, account.number);
    evidence.verification.push({
      account: account.number,
      expected,
      actual: prompt.useCount,
    });
    assert.equal(prompt.useCount, expected);
  }
  evidence.storage = await capacityStorage(instance);
} catch (error) {
  evidence.failure = String(error);
  process.exitCode = 1;
} finally {
  await Bun.write(
    "docs/evidence/issue-65-post-load.json",
    JSON.stringify(evidence, null, 2)
  );
  process.stdout.write(
    `${JSON.stringify({ failure: evidence.failure, readinessFailure: evidence.readinessFailure, verifiedAccounts: evidence.verification.length })}\n`
  );
}
