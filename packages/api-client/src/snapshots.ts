import type { LibraryScope } from "@pr0/api-contract/prompts";
import {
  snapshotLimits,
  snapshotManifestSchema,
  snapshotPageSchema,
  snapshotRecordsSchema,
} from "@pr0/api-contract/snapshots";
import type { SnapshotManifest } from "@pr0/api-contract/snapshots";
import type { z } from "zod";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
// oxlint-disable eslint/no-await-in-loop -- Consume a bounded HTTP stream sequentially.
const boundedJson = async <T>(
  response: Response,
  limit: number,
  schema: z.ZodType<T>,
  signal: AbortSignal
) => {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 410 ? "snapshot_expired" : "snapshot_unavailable"
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("invalid_response");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = async () => {
    try {
      await reader.cancel();
    } catch {
      /* A failed stream may already be closed; preserve the original failure. */
    }
  };
  const abort = () => {
    void cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > limit) {
        throw new Error("invalid_response");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return schema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  );
};
export const createSnapshotClient = (
  origin: string,
  scope: LibraryScope,
  fetcher: Fetcher = fetch
) => {
  const request = async <T>(
    path: string,
    body: Record<string, never> | { id: string; page: number },
    limit: number,
    schema: z.ZodType<T>,
    cancellation?: AbortSignal
  ) => {
    const timeout = AbortSignal.timeout(30_000);
    const signal = cancellation
      ? AbortSignal.any([cancellation, timeout])
      : timeout;
    return boundedJson(
      await fetcher(
        `${origin.replace(/\/$/u, "")}/api/v1/sync/snapshots${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          redirect: "error",
          cache: "no-store",
          signal,
        }
      ),
      limit,
      schema,
      signal
    );
  };
  return {
    create: async (signal?: AbortSignal) => {
      const manifest = await request(
        "",
        {},
        snapshotLimits.manifestBytes,
        snapshotManifestSchema,
        signal
      );
      if (
        manifest.accountId !== scope.accountId ||
        manifest.instanceId !== scope.instanceId
      ) {
        throw new Error("snapshot_identity_mismatch");
      }
      return manifest;
    },
    page: async (
      manifest: SnapshotManifest,
      page: number,
      signal?: AbortSignal
    ) => {
      if (
        manifest.accountId !== scope.accountId ||
        manifest.instanceId !== scope.instanceId ||
        !manifest.pages[page]
      ) {
        throw new Error("snapshot_identity_mismatch");
      }
      const result = await request(
        "/page",
        { id: manifest.id, page },
        snapshotLimits.pageBytes,
        snapshotPageSchema,
        signal
      );
      const bytes = new TextEncoder().encode(result.payload);
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (
        result.id !== manifest.id ||
        result.page !== page ||
        bytes.length !== manifest.pages[page].bytes ||
        digest !== manifest.pages[page].digest
      ) {
        throw new Error("snapshot_digest_mismatch");
      }
      const records = snapshotRecordsSchema.parse(JSON.parse(result.payload));
      if (
        (page === 0) !== (records.organization !== null) ||
        (records.organization &&
          records.organization.revision !== manifest.revision)
      ) {
        throw new Error("invalid_response");
      }
      if (
        records.prompts.some(
          (prompt) =>
            prompt.instanceId !== scope.instanceId ||
            prompt.accountId !== scope.accountId ||
            BigInt(prompt.revision) > BigInt(manifest.revision)
        ) ||
        (records.organization &&
          (records.organization.instanceId !== scope.instanceId ||
            records.organization.accountId !== scope.accountId))
      ) {
        throw new Error("snapshot_identity_mismatch");
      }
      return records;
    },
  };
};
