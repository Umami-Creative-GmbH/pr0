import { expect, test } from "bun:test";

import {
  deletionLogFilename,
  deletionLogLine,
  expiredDeletionLogs,
  isDeletionLogFile,
} from "./deletion-log-files";

test("deletion log files are monthly by the UTC month of the deletion", () => {
  expect(deletionLogFilename("2026-11-30T23:59:59.999Z")).toBe(
    "deletions-2026-11.jsonl"
  );
  expect(deletionLogFilename("2026-12-01T00:00:00.000Z")).toBe(
    "deletions-2026-12.jsonl"
  );
  expect(isDeletionLogFile("deletions-2026-11.jsonl")).toBe(true);
  expect(isDeletionLogFile("deletions-2026-11.jsonl.tmp")).toBe(false);
});

test("a month's file expires 31 days after the month ends and nothing else is selected", () => {
  const names = [
    "deletions-2026-09.jsonl",
    "deletions-2026-10.jsonl",
    "deletions-2026-11.jsonl",
    "notes.txt",
    "backup-2026-01.jsonl",
  ];
  // October ends 2026-11-01T00:00Z; it is kept through 2026-12-02T00:00Z.
  expect(
    expiredDeletionLogs(names, Date.parse("2026-12-02T00:00:00.000Z"))
  ).toEqual(["deletions-2026-09.jsonl"]);
  expect(
    expiredDeletionLogs(names, Date.parse("2026-12-02T00:00:00.001Z"))
  ).toEqual(["deletions-2026-09.jsonl", "deletions-2026-10.jsonl"]);
});

test("the line holds the event, opaque account ID and time only", () => {
  expect(
    JSON.parse(
      deletionLogLine(
        "account_deleted",
        "00000000-0000-4000-8000-000000000001",
        "2026-11-11T10:00:00.000Z"
      )
    )
  ).toEqual({
    event: "account_deleted",
    accountId: "00000000-0000-4000-8000-000000000001",
    deletedAt: "2026-11-11T10:00:00.000Z",
  });
});
