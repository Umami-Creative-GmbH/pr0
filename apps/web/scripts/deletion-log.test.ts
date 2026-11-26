import { expect, test } from "bun:test";

import { deletionsFromLog } from "./deletion-log";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";

test("deletion log yields each deleted account once with its first deletion time", () => {
  const log = [
    `{"event":"account_deleted","accountId":"${first}","deletedAt":"2026-11-01T10:00:00.000Z"}`,
    `web-1  | {"event":"account_deleted","accountId":"${second}","deletedAt":"2026-11-02T10:00:00.000Z"}`,
    `{"event":"account_redeleted","accountId":"${first}","deletedAt":"2026-11-01T10:00:00.000Z"}`,
    '{"event":"request_failed","boundary":"account","code":"unavailable"}',
    "plain text, {not json",
    '{"event":"account_deleted","accountId":"not-a-uuid","deletedAt":"2026-11-03T10:00:00.000Z"}',
    "",
  ].join("\r\n");
  expect(deletionsFromLog(log)).toEqual([
    { accountId: first, deletedAt: "2026-11-01T10:00:00.000Z" },
    { accountId: second, deletedAt: "2026-11-02T10:00:00.000Z" },
  ]);
});
