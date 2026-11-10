import { expect, test } from "bun:test";

import type { UploadStatus } from "@pr0/api-contract/local-prompts";
import { statusTone } from "@pr0/ui/lib/present";

import { downloadError } from "../../desktop/src/library-client";
import { uploadLabel } from "../../desktop/src/upload-status";

const upload = (error: string | null): UploadStatus => ({
  waiting: 2,
  awaitingDownload: 0,
  attentionError: null,
  error,
  retryAfterMs: 0,
  lastCheckedAt: null,
  mappings: [],
  pending: [],
  errors: [],
});

test("an untrusted instance certificate is a distinct state from offline", () => {
  const untrusted = uploadLabel(
    true,
    false,
    2,
    upload("certificate_untrusted")
  );
  const offline = uploadLabel(true, false, 2, upload("network_unavailable"));
  expect(untrusted).toBe("Untrusted certificate · Changes waiting");
  expect(offline).toBe("Offline · Changes waiting to sync");
  const idleUntrusted = uploadLabel(
    true,
    false,
    0,
    upload("certificate_untrusted")
  );
  expect(idleUntrusted).toBe("Untrusted certificate");
  expect(statusTone(idleUntrusted)).toBe("attention");
  expect(
    statusTone(uploadLabel(true, false, 0, upload("network_unavailable")))
  ).toBe("offline");
});

test("an untrusted certificate wins over the offline flag while it is the upload error", () => {
  expect(uploadLabel(true, true, 1, upload("certificate_untrusted"))).toBe(
    "Untrusted certificate · Changes waiting"
  );
});

test("an untrusted certificate during download explains how to recover", () => {
  const message = downloadError("certificate_untrusted");
  expect(message).toContain("Windows doesn't trust this server's certificate");
  expect(message).toContain("certificate authority in Windows");
  expect(message).not.toContain("Offline");
});
