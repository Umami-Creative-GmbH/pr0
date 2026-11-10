import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "availability.ts");
const minute = 60_000;
const burnInMinutes = 7 * 1440;
const start = Date.parse("2026-09-27T00:00:00.000Z");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const sample = (time: number, available: boolean, durationMs = 120) =>
  `${JSON.stringify({ at: new Date(time).toISOString(), available, durationMs })}\n`;

/** Writes one evidence file per UTC month, as the probe host's monthly rotation does. */
const evidence = async (lines: { time: number; text: string }[]) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-burn-in-"));
  directories.push(directory);
  const months = new Map<string, string[]>();
  for (const { time, text } of lines) {
    const month = new Date(time).toISOString().slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), text]);
  }
  const files: string[] = [];
  for (const [month, texts] of months) {
    const file = path.join(directory, `${month}.jsonl`);
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each monthly file is written once before the command reads them.
    await Bun.write(file, texts.join(""));
    files.push(file);
  }
  return files;
};

const everyMinute = (
  from: number,
  count: number,
  available: (index: number) => boolean = () => true
) =>
  Array.from({ length: count }, (_, index) => {
    const time = from + index * minute + 7000;
    return { time, text: sample(time, available(index)) };
  });

const burnIn = async (...args: string[]) => {
  const child = Bun.spawn(["bun", script, "burn-in", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, report: stdout ? JSON.parse(stdout) : null };
};

test("a complete burn-in window spanning two monthly evidence files reaches the target", async () => {
  const files = await evidence(
    everyMinute(start, burnInMinutes, (index) => index >= 50)
  );
  expect(files).toHaveLength(2);
  const { exitCode, report } = await burnIn(
    "2026-09-27T00:00:00.000Z",
    ...files
  );
  expect(exitCode).toBe(0);
  expect(report).toEqual({
    start: "2026-09-27T00:00:00.000Z",
    end: "2026-10-04T00:00:00.000Z",
    windowMinutes: burnInMinutes,
    elapsedMinutes: burnInMinutes,
    complete: true,
    availableMinutes: burnInMinutes - 50,
    missingMinutes: 0,
    unavailableMinutes: 50,
    availabilityPercent: (100 * (burnInMinutes - 50)) / burnInMinutes,
    targetPercent: 99.5,
    targetMet: true,
  });
});

test("missing minutes count unavailable and can fail the burn-in", async () => {
  const files = await evidence(
    everyMinute(start, burnInMinutes).filter((_, index) => index % 100 !== 0)
  );
  const { exitCode, report } = await burnIn(
    "2026-09-27T00:00:00.000Z",
    ...files
  );
  expect(exitCode).toBe(1);
  expect(report).toMatchObject({
    missingMinutes: Math.ceil(burnInMinutes / 100),
    unavailableMinutes: Math.ceil(burnInMinutes / 100),
    complete: true,
    targetMet: false,
  });
});

test("a failed duplicate sample makes its whole minute unavailable", async () => {
  const lines = everyMinute(start, burnInMinutes);
  const failed = Array.from({ length: 60 }, (_, index) => {
    const time = start + index * minute + 45_000;
    return { time, text: sample(time, false) };
  });
  const slow = start + 100 * minute + 30_000;
  const files = await evidence([
    ...lines,
    ...failed,
    { time: slow, text: sample(slow, true, 15_001) },
  ]);
  const { report } = await burnIn("2026-09-27T00:00:00.000Z", ...files);
  expect(report).toMatchObject({
    missingMinutes: 0,
    unavailableMinutes: 61,
    targetMet: false,
  });
});

test("partial minutes belong to the minute they started in and the window end is exclusive", async () => {
  const lastMoment = start + minute - 1;
  const end = start + burnInMinutes * minute;
  const files = await evidence([
    { time: start - 1, text: sample(start - 1, false) },
    { time: lastMoment, text: sample(lastMoment, true) },
    ...everyMinute(start + minute, burnInMinutes - 1),
    { time: end, text: sample(end, false) },
  ]);
  const { report } = await burnIn("2026-09-27T00:00:00.000Z", ...files);
  expect(report).toMatchObject({
    availableMinutes: burnInMinutes,
    unavailableMinutes: 0,
    targetMet: true,
  });
});

test("an unfinished window counts the current partial minute but never meets the target", async () => {
  const now = Date.now();
  const windowStart = Math.floor(now / minute) * minute - 10 * minute;
  const files = await evidence(everyMinute(windowStart, 10));
  const { exitCode, report } = await burnIn(
    new Date(windowStart).toISOString(),
    ...files
  );
  expect(exitCode).toBe(1);
  expect(report).toMatchObject({
    windowMinutes: burnInMinutes,
    elapsedMinutes: 11,
    availableMinutes: 10,
    missingMinutes: 1,
    complete: false,
    targetMet: false,
  });
});

test("the window must start on a whole UTC minute", async () => {
  const files = await evidence(everyMinute(start, 1));
  const { exitCode, report } = await burnIn(
    "2026-09-27T00:00:30.000Z",
    ...files
  );
  expect(exitCode).not.toBe(0);
  expect(report).toBeNull();
});
