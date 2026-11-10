import { appendFileSync, readFileSync } from "node:fs";

import { createApiClient } from "@pr0/api-client/client";
import { createPromptClient } from "@pr0/api-client/prompts";
import {
  availabilityBoundMs,
  availabilitySampleSchema,
} from "@pr0/api-contract/operator-output";
import { z } from "zod";

const minuteMs = 60_000;
const targetPercent = 99.5;
const burnInMinutes = 7 * 1440;
/** Evidence is rotated monthly; a larger file means rotation stopped. */
const maximumEvidenceBytes = 32 * 1024 * 1024;
const [command, ...args] = process.argv.slice(2);
if (!args[0]) {
  throw new Error(
    "Use probe <samples.jsonl>, report <samples.jsonl> <YYYY-MM> or burn-in <start> <samples.jsonl>..."
  );
}

/** Counts UTC minutes in [start, end) that have at least one sample and no failed or slow sample. */
const minuteSlots = async (files: string[], start: number, end: number) => {
  const slots = new Map<number, boolean>();
  for (const name of files) {
    const file = Bun.file(name);
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Evidence files are read one at a time to bound memory.
    if (!(await file.exists())) {
      continue;
    }
    if (file.size > maximumEvidenceBytes) {
      throw new Error("Rotate probe evidence monthly (maximum 32 MiB)");
    }
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Evidence files are read one at a time to bound memory.
    const evidence = await file.text();
    for (const line of evidence.split("\n")) {
      try {
        const sample = availabilitySampleSchema.parse(JSON.parse(line));
        const time = Date.parse(sample.at);
        if (time >= start && time < end) {
          const slot = Math.floor((time - start) / minuteMs);
          slots.set(
            slot,
            (slots.get(slot) ?? true) &&
              sample.available &&
              sample.durationMs <= availabilityBoundMs
          );
        }
      } catch {
        /* Malformed or absent observations supply no availability coverage. */
      }
    }
  }
  return {
    coveredMinutes: slots.size,
    availableMinutes: [...slots.values()].filter(Boolean).length,
  };
};

/** Elapsed minutes include the current partial minute, as the monthly report does. */
const elapsedEnd = (end: number) =>
  Math.min(end, Math.ceil(Date.now() / minuteMs) * minuteMs);

if (command === "probe") {
  const [filename = ""] = args;
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
    const signal = AbortSignal.timeout(availabilityBoundMs);
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
  const sample = availabilitySampleSchema.parse({
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
  const [filename = "", month] = args;
  const selected = z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u)
    .parse(month);
  const start = Date.parse(`${selected}-01T00:00:00.000Z`);
  const date = new Date(start);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const end = elapsedEnd(date.getTime());
  const expectedMinutes = Math.max(0, Math.ceil((end - start) / minuteMs));
  const { coveredMinutes, availableMinutes } = await minuteSlots(
    [filename],
    start,
    end
  );
  const availabilityPercent = expectedMinutes
    ? (100 * availableMinutes) / expectedMinutes
    : 0;
  process.stdout.write(
    `${JSON.stringify({
      month: selected,
      expectedMinutes,
      availableMinutes,
      missingMinutes: expectedMinutes - coveredMinutes,
      unavailableMinutes: expectedMinutes - availableMinutes,
      availabilityPercent,
      targetPercent,
      targetMet: expectedMinutes > 0 && availabilityPercent >= targetPercent,
    })}\n`
  );
} else if (command === "burn-in") {
  const [startMinute, ...monthFiles] = args;
  const start = z.iso
    .datetime()
    .transform((value) => Date.parse(value))
    .refine((time) => time % minuteMs === 0, "Start on a whole UTC minute")
    .parse(startMinute);
  const files = z
    .array(z.string().min(1))
    .min(1, "Name every monthly evidence file the window spans")
    .parse(monthFiles.filter(Boolean));
  const windowEnd = start + burnInMinutes * minuteMs;
  const end = elapsedEnd(windowEnd);
  const elapsedMinutes = Math.max(0, Math.ceil((end - start) / minuteMs));
  const { coveredMinutes, availableMinutes } = await minuteSlots(
    files,
    start,
    end
  );
  const complete = end === windowEnd;
  const availabilityPercent = elapsedMinutes
    ? (100 * availableMinutes) / elapsedMinutes
    : 0;
  const targetMet = complete && availabilityPercent >= targetPercent;
  process.stdout.write(
    `${JSON.stringify({
      start: new Date(start).toISOString(),
      end: new Date(windowEnd).toISOString(),
      windowMinutes: burnInMinutes,
      elapsedMinutes,
      complete,
      availableMinutes,
      missingMinutes: elapsedMinutes - coveredMinutes,
      unavailableMinutes: elapsedMinutes - availableMinutes,
      availabilityPercent,
      targetPercent,
      targetMet,
    })}\n`
  );
  if (!targetMet) {
    process.exitCode = 1;
  }
} else {
  throw new Error("Use probe, report or burn-in");
}
