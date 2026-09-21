import { appendFileSync, readFileSync } from "node:fs";

import { createApiClient } from "@pr0/api-client/client";
import { createPromptClient } from "@pr0/api-client/prompts";
import { z } from "zod";

const sampleSchema = z.strictObject({
  at: z.iso.datetime(),
  available: z.boolean(),
  durationMs: z.number().nonnegative(),
});
const [command, filename, month] = process.argv.slice(2);
if (!filename) {
  throw new Error(
    "Use probe <samples.jsonl> or report <samples.jsonl> <YYYY-MM>"
  );
}

if (command === "probe") {
  const at = new Date().toISOString();
  const started = performance.now();
  let available = false;
  try {
    const url = new URL(process.env.PR0_PROBE_ORIGIN ?? "");
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    ) {
      throw new Error("HTTPS required");
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Canonical origin required");
    }
    const cookie = readFileSync(
      process.env.PR0_PROBE_COOKIE_FILE ?? "",
      "utf-8"
    ).trim();
    if (!cookie || cookie.length > 4096) {
      throw new Error("Probe credential required");
    }
    const promptId = z.uuid().parse(process.env.PR0_PROBE_PROMPT_ID);
    const signal = AbortSignal.timeout(15_000);
    const fetcher = (input: string, init: RequestInit) =>
      fetch(input, {
        ...init,
        signal,
        redirect: "error",
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          Cookie: cookie,
        },
      });
    const account = await createApiClient({
      baseUrl: url.origin,
      fetcher,
    }).getLibrary(signal);
    const results = await createPromptClient(url.origin, fetcher).getPrompts(
      { query: "pr0-availability-canary", limit: 1 },
      signal
    );
    available =
      results.accountId === account.account.id &&
      results.instanceId === account.instance.id &&
      results.prompts[0]?.id === promptId;
  } catch {
    /* An unavailable credential, network, library or search is one failed sample; never log the cause or payload. */
  }
  const sample = sampleSchema.parse({
    at,
    available,
    durationMs: Math.round(performance.now() - started),
  });
  appendFileSync(filename, `${JSON.stringify(sample)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(sample)}\n`);
  if (!available) {
    process.exitCode = 1;
  }
} else if (command === "report") {
  const selected = z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u)
    .parse(month);
  const start = Date.parse(`${selected}-01T00:00:00.000Z`);
  const date = new Date(start);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const end = Math.min(date.getTime(), Math.ceil(Date.now() / 60_000) * 60_000);
  const expectedMinutes = Math.max(0, Math.ceil((end - start) / 60_000));
  const slots = new Map<number, boolean>();
  const file = Bun.file(filename);
  if (await file.exists()) {
    if (file.size > 32 * 1024 * 1024) {
      throw new Error("Rotate probe evidence monthly (maximum 32 MiB)");
    }
    const evidence = await file.text();
    for (const line of evidence.split("\n")) {
      try {
        const sample = sampleSchema.parse(JSON.parse(line));
        const time = Date.parse(sample.at);
        if (time >= start && time < end) {
          const slot = Math.floor((time - start) / 60_000);
          slots.set(
            slot,
            (slots.get(slot) ?? true) &&
              sample.available &&
              sample.durationMs <= 15_000
          );
        }
      } catch {
        /* Malformed or absent observations supply no availability coverage. */
      }
    }
  }
  const availableMinutes = [...slots.values()].filter(Boolean).length;
  const availabilityPercent = expectedMinutes
    ? (100 * availableMinutes) / expectedMinutes
    : 0;
  process.stdout.write(
    `${JSON.stringify({
      month: selected,
      expectedMinutes,
      availableMinutes,
      missingMinutes: expectedMinutes - slots.size,
      unavailableMinutes: expectedMinutes - availableMinutes,
      availabilityPercent,
      targetPercent: 99.5,
      targetMet: expectedMinutes > 0 && availabilityPercent >= 99.5,
    })}\n`
  );
} else {
  throw new Error("Use probe or report");
}
