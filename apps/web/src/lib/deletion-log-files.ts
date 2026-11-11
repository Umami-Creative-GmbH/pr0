/**
 * Names, line format and retention of the deletion log's monthly files
 * (ADR-0005). Pure, so the server, the operator commands and tests share it.
 */
const monthlyName = /^deletions-(?<year>\d{4})-(?<month>\d{2})\.jsonl$/u;
const dayMs = 24 * 60 * 60 * 1000;
/** A month's file is kept until 31 days after that month ends. */
export const deletionLogRetentionMs = 31 * dayMs;

export type DeletionLogEvent = "account_deleted" | "account_redeleted";

/** `deletions-YYYY-MM.jsonl`, by the UTC month of the deletion. */
export const deletionLogFilename = (deletedAt: string) =>
  `deletions-${new Date(deletedAt).toISOString().slice(0, 7)}.jsonl`;

/** The exact line written to stdout and to the file: no email, ever. */
export const deletionLogLine = (
  event: DeletionLogEvent,
  accountId: string,
  deletedAt: string
) => JSON.stringify({ event, accountId, deletedAt });

export const isDeletionLogFile = (name: string) => monthlyName.test(name);

/** Monthly files whose retention ended before `now`; other names are never selected. */
export const expiredDeletionLogs = (names: string[], now: number) =>
  names.filter((name) => {
    const match = monthlyName.exec(name);
    if (!match?.groups) {
      return false;
    }
    const monthEnd = Date.UTC(
      Number(match.groups.year),
      Number(match.groups.month),
      1
    );
    return monthEnd + deletionLogRetentionMs < now;
  });
