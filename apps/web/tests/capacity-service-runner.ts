// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Fixed arrival times, account setup and fixture transitions are deliberately sequential.
import assert from "node:assert/strict";

import { librarySchema } from "@pr0/api-contract/accounts";
import {
  promptPageSchema,
  mutationResponseSchema,
  promptErrorSchema,
  promptSchema,
} from "@pr0/api-contract/prompts";

import { measureCapacityCatchUp } from "./capacity-catch-up";
import { capacityId } from "./capacity-corpus";
import { monitorCapacityService } from "./capacity-monitor";
import type { CapacityResourceSample } from "./capacity-monitor";
import { capacityServiceFixture } from "./capacity-service-fixture";
import { measureCapacityWeb } from "./capacity-web";
import type { SelfHostingInstance } from "./self-hosting-fixture";

interface Sample {
  phase: string;
  number: number;
  account: number;
  scheduledMs: number;
  dispatchDelayMs: number;
  durationMs: number;
  status: number;
  bytes: number;
  error: string | null;
  retryAfter: string | null;
}
interface LoadAccount {
  cookie: string;
  identity: {
    protocolVersion: 1;
    instanceId: string;
    accountId: string;
    epoch: string;
    installationId: string;
  };
}
const queries = [
  "a",
  "C++",
  "common",
  "cafe resume common equipe reponses",
  "Σίσυφος 東京",
  "🎯",
  "never-present-6500",
];
const requestSample = async (
  instance: SelfHostingInstance,
  account: LoadAccount,
  sample: Sample
) => {
  const started = performance.now();
  const turn = Math.floor(sample.number / 20);
  const write = turn % 5 === 0;
  const operationId = crypto.randomUUID();
  const query = queries[turn % queries.length] ?? "common";
  try {
    const pathname = write
      ? "/api/v1/sync/mutations"
      : `/api/v1/library/prompts?query=${encodeURIComponent(query)}&limit=50`;
    const response = await fetch(instance.origin + pathname, {
      method: write ? "POST" : "GET",
      headers: {
        Cookie: account.cookie,
        Origin: instance.origin,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: write
        ? JSON.stringify({
            ...account.identity,
            operations: [
              {
                kind: "prompt.use",
                operationId,
                promptId: capacityId(1),
                baseRevision: "1",
                dependsOn: [],
                occurredAt: new Date().toISOString(),
              },
            ],
          })
        : undefined,
    });
    sample.status = response.status;
    sample.retryAfter = response.headers.get("Retry-After");
    const body = await response.text();
    sample.bytes = Buffer.byteLength(body);
    assert.ok(sample.bytes <= 4_194_304, "Response exceeds 4 MiB");
    const payload: unknown = JSON.parse(body);
    if (!response.ok) {
      const failure = promptErrorSchema.safeParse(payload);
      sample.error = failure.success
        ? failure.data.code
        : "invalid_error_response";
      if (response.status === 429 || response.status === 503) {
        assert.ok(
          Number(sample.retryAfter) > 0,
          "Overload needs a retry delay"
        );
      }
      return;
    }
    if (write) {
      const [result] = mutationResponseSchema.parse(payload).results;
      assert.equal(
        result?.status,
        "accepted",
        "A rejected mutation is not successful throughput"
      );
      assert.ok(
        result && "operationId" in result && result.operationId === operationId,
        "Wrong acknowledgement identity"
      );
    } else {
      const page = promptPageSchema.parse(payload);
      assert.equal(page.accountId, account.identity.accountId);
      assert.equal(page.instanceId, account.identity.instanceId);
      assert.equal(
        page.prompts.length,
        query === "never-present-6500" ? 0 : 50
      );
      assert.equal(
        new Set(page.prompts.map((prompt) => prompt.id)).size,
        page.prompts.length
      );
    }
  } catch (error) {
    sample.error = String(error).slice(0, 500);
  } finally {
    sample.durationMs = performance.now() - started;
  }
};

const runPhase = async (
  instance: SelfHostingInstance,
  accounts: LoadAccount[],
  phase: string,
  rate: number,
  seconds: number,
  samples: Sample[]
) => {
  const started = performance.now();
  const inFlight = new Map<number, Promise<void>>();
  for (let number = 0; number < rate * seconds; number += 1) {
    const scheduledMs = (number * 1000) / rate;
    await Bun.sleep(Math.max(0, started + scheduledMs - performance.now()));
    const sample: Sample = {
      phase,
      number,
      account: number % 20,
      scheduledMs,
      dispatchDelayMs: performance.now() - started - scheduledMs,
      durationMs: 0,
      status: 0,
      bytes: 0,
      error: null,
      retryAfter: null,
    };
    samples.push(sample);
    const account = accounts[sample.account];
    assert.ok(account);
    if (inFlight.size >= 20) {
      sample.error = "client_concurrency_exhausted";
      continue;
    }
    const pending = (async () => {
      try {
        await requestSample(instance, account, sample);
      } finally {
        inFlight.delete(number);
      }
    })();
    inFlight.set(number, pending);
    if (number % (rate * 60) === 0) {
      process.stdout.write(
        `${phase}: ${number}/${rate * seconds} scheduled; ${samples.filter((item) => item.error).length} failures\n`
      );
    }
  }
  await Promise.all(inFlight.values());
  // Hold the full declared interval, even if the final response completes quickly.
  await Bun.sleep(Math.max(0, started + seconds * 1000 - performance.now()));
};

const prepareAccount = async (
  instance: SelfHostingInstance,
  number: number
): Promise<LoadAccount> => {
  const cookie = await instance.login(`capacity-${number}@example.test`);
  const library = librarySchema.parse(await instance.library(cookie));
  const account: LoadAccount = {
    cookie,
    identity: {
      protocolVersion: 1,
      instanceId: library.instance.id,
      accountId: library.account.id,
      epoch: library.epoch,
      installationId: crypto.randomUUID(),
    },
  };
  const deadline = performance.now() + 600_000;
  while (true) {
    const response = await instance.request(
      "/api/v1/library/prompts?query=common",
      undefined,
      cookie
    );
    if (response.ok) {
      const page = promptPageSchema.parse(await response.json());
      assert.equal(page.prompts.length, 50);
      break;
    }
    const error = promptErrorSchema.parse(await response.json());
    assert.ok(
      performance.now() < deadline && error.retryable,
      JSON.stringify(error)
    );
    await Bun.sleep((error.retryAfter ?? 1) * 1000);
  }
  return account;
};

const instance = await capacityServiceFixture();
const samples: Sample[] = [];
const resources: CapacityResourceSample[] = [];
const resourceController = new AbortController();
let monitoring: Promise<void> | undefined;
const smoke = process.argv.includes("--smoke");
let catchUp: Awaited<ReturnType<typeof measureCapacityCatchUp>> | undefined;
const evidence = {
  recordedAt: new Date().toISOString(),
  bun: Bun.version,
  smoke,
  classification:
    "supporting evidence: shared Linux Docker VM, same two CPUs for all resident services, memory limits sum to 3776 MiB; backing disk is shared and has no 64 GiB hard quota; not a dedicated 2-vCPU/4-GiB/64-GiB machine",
  fixture:
    "1000 accounts, exactly 10737418240 logical UTF-8 bytes, one 10000-prompt/100-MiB library, 20 authenticated active accounts; 80% search and 20% durable usage mutations; no retries during timed load",
  seed: "",
  storageBefore: "",
  storageAfter: "",
  containerStats: "",
  image: "",
  fixtureLocation: {
    origin: instance.origin,
    project: instance.project,
    directory: instance.directory,
  },
  serverBun: "",
  preparedAccounts: 0,
  searchStorage: "",
  ledgerStorage: "",
  failure: "",
  passed: false,
  samples,
  resources,
};
try {
  process.stdout.write(
    "Preparing 1000 accounts and 10 GiB; fixture-only database setup.\n"
  );
  evidence.seed = await instance.seed();
  evidence.image = await instance.compose("images", "--format", "json");
  evidence.serverBun = await instance.compose(
    "exec",
    "-T",
    "web",
    "bun",
    "--version"
  );
  process.stdout.write(evidence.seed.slice(-700));
  const accounts: LoadAccount[] = [];
  for (let number = 0; number < (smoke ? 20 : 1000); number += 1) {
    const account = await prepareAccount(instance, number);
    if (number < 20) {
      accounts.push(account);
    }
    evidence.preparedAccounts += 1;
    if (number < 20 || number % 20 === 19) {
      process.stdout.write(
        `Prepared account ${number + 1}/${smoke ? 20 : 1000}\n`
      );
    }
  }
  const [webAccount] = accounts;
  assert.ok(webAccount);
  if (process.argv.includes("--web")) {
    await measureCapacityWeb(instance, webAccount.cookie);
    await Bun.sleep(60_000);
  }
  const storage = async () =>
    await instance.compose(
      "exec",
      "-T",
      "database",
      "psql",
      "-U",
      "pr0",
      "-d",
      "pr0",
      "-At",
      "-c",
      `SELECT json_build_object('databaseBytes',pg_database_size(current_database()),'walBytes',(SELECT sum(size) FROM pg_ls_waldir()),'tables',(SELECT json_agg(t) FROM (SELECT relname,pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC) t));`
    );
  evidence.storageBefore = await storage();
  monitoring = monitorCapacityService(
    instance,
    resourceController.signal,
    resources
  );
  await runPhase(
    instance,
    accounts,
    "sustained",
    10,
    smoke ? 10 : 1800,
    samples
  );
  await runPhase(instance, accounts, "burst", 30, smoke ? 10 : 60, samples);
  const catchUpAccount = accounts.at(19);
  assert.ok(catchUpAccount);
  catchUp = await measureCapacityCatchUp(instance, catchUpAccount.cookie);
  // Acknowledged uses remain readable after a production server restart.
  await instance.compose("restart", "web");
  await instance.ready();
  for (const [index, account] of accounts.entries()) {
    const response = await instance.request(
      `/api/v1/library/prompts/${capacityId(1)}`,
      undefined,
      account.cookie
    );
    assert.equal(response.status, 200);
    const prompt = promptSchema.parse(await response.json());
    const acknowledged = samples.filter(
      (sample) =>
        sample.account === index &&
        sample.status === 200 &&
        !sample.error &&
        Math.floor(sample.number / 20) % 5 === 0
    ).length;
    assert.equal(
      prompt.useCount,
      acknowledged,
      "Acknowledged usage differs after restart"
    );
  }
  evidence.storageAfter = await storage();
  evidence.containerStats = await instance.compose(
    "stats",
    "--no-stream",
    "--format",
    "json"
  );
  evidence.searchStorage = await instance.compose(
    "exec",
    "-T",
    "web",
    "du",
    "-sb",
    "/var/lib/pr0-search"
  );
  evidence.ledgerStorage = await instance.compose(
    "exec",
    "-T",
    "ledger-a",
    "psql",
    "-U",
    "pr0",
    "-d",
    "ledger",
    "-At",
    "-c",
    "SELECT pg_database_size(current_database())"
  );
  evidence.passed =
    !smoke &&
    samples.length === 19_800 &&
    samples.every(
      (sample) =>
        !sample.error && sample.status === 200 && sample.dispatchDelayMs <= 100
    ) &&
    catchUp.elapsedMs <= 60_000;
  if (samples.some((sample) => sample.error)) {
    throw new Error(
      "The capacity workload recorded failed requests; see per-arrival evidence"
    );
  }
} catch (error) {
  evidence.failure = String(error);
  process.exitCode = 1;
} finally {
  resourceController.abort();
  await monitoring;
  await Bun.write(
    "docs/evidence/issue-65-service.json",
    `${JSON.stringify({ ...evidence, catchUp }, null, 2)}\n`
  );
  if (evidence.failure && process.argv.includes("--keep-on-failure")) {
    process.stdout.write(
      `Retained disposable fixture ${instance.project} at ${instance.origin}; configuration in ${instance.directory}\n`
    );
  } else {
    await instance.cleanup();
  }
}
