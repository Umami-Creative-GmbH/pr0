import "server-only";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import {
  deletionLogFilename,
  expiredDeletionLogs,
} from "../lib/deletion-log-files";

/**
 * The durable deletion log (ADR-0005): monthly files under
 * PR0_DELETION_LOG_DIRECTORY, a directory on off-server storage that is never
 * the backup directory. Unset means the deletion log is stdout only.
 */
export const deletionLogDirectory = () => {
  const value = process.env.PR0_DELETION_LOG_DIRECTORY?.trim();
  return value
    ? path.resolve(
        // oxlint-disable-next-line eslint/no-inline-comments -- Turbopack requires its directive inside the filesystem call.
        /* turbopackIgnore: true */ value
      )
    : null;
};

/**
 * Appends one line and flushes it to storage before returning. Throws when the
 * directory is configured but missing or not writable, so the caller's
 * transaction rolls back and no deletion goes unrecorded.
 */
export const appendDeletionLog = (line: string, deletedAt: string) => {
  const directory = deletionLogDirectory();
  if (!directory) {
    return false;
  }
  if (!statSync(directory).isDirectory()) {
    throw new Error("Deletion log directory unavailable");
  }
  const filename = path.join(directory, deletionLogFilename(deletedAt));
  const created = !existsSync(filename);
  const fd = openSync(filename, "a", 0o640);
  try {
    writeSync(fd, `${line}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (created && process.platform !== "win32") {
    // A new file's directory entry must be durable too.
    const directoryFd = openSync(directory, "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  }
  return true;
};

/** Removes monthly files past retention; run by `backup create` and `backup retention`. */
export const removeExpiredDeletionLogs = (now = Date.now()) => {
  const directory = deletionLogDirectory();
  if (!directory) {
    return [];
  }
  const expired = expiredDeletionLogs(readdirSync(directory), now);
  for (const name of expired) {
    unlinkSync(path.join(directory, name));
  }
  return expired;
};
