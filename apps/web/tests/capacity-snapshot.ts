// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Snapshot pages are written in manifest order with bounded working memory.
import assert from "node:assert/strict";
import path from "node:path";

import { utf8Bytes } from "@pr0/api-contract/prompts";
import {
  snapshotRecordsSchema,
  snapshotManifestSchema,
} from "@pr0/api-contract/snapshots";

import {
  capacityBytes,
  capacityCount,
  capacityId,
  capacityText,
  capacityCollections,
  capacityTags,
  capacityOrganizationBytes,
} from "./capacity-corpus";

export const capacityIdentity = {
  instanceId: "11111111-1111-4111-8111-111111111111",
  accountId: "33333333-3333-4333-8333-333333333333",
};
export const writeCapacitySnapshot = async (directory: string) => {
  const id = "55555555-5555-4555-8555-555555555555";
  const pages = [];
  let textBytes = capacityOrganizationBytes;
  const recordsPerPage = 250;
  for (let page = 0; page < capacityCount / recordsPerPage; page += 1) {
    const prompts = Array.from({ length: recordsPerPage }, (unused, index) => {
      const number = page * recordsPerPage + index + 1;
      const text = capacityText(number);
      return {
        ...capacityIdentity,
        ...text,
        id: capacityId(number),
        revision: String(number),
        createdAt: "2026-01-01T00:00:00.000Z",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        favorite: false,
        archived: false,
        collectionId: capacityId(((number - 1) % 200) + 1, 1),
        tagIds: Array.from({ length: 20 }, (_, tag) =>
          capacityId(((number - 1) % 50) * 20 + tag + 1, 2)
        ),
        useCount: 0,
        lastUsedAt: null,
        sourceTitle: null,
      };
    });
    textBytes += prompts.reduce(
      (sum, prompt) =>
        sum + utf8Bytes(prompt.title + prompt.description + prompt.content),
      0
    );
    const records = snapshotRecordsSchema.parse({
      organization:
        page === 0
          ? {
              ...capacityIdentity,
              revision: "10000",
              textBytes: capacityBytes,
              collections: capacityCollections,
              tags: capacityTags,
            }
          : null,
      prompts,
    });
    const payload = JSON.stringify(records);
    pages.push({
      bytes: utf8Bytes(payload),
      digest: new Bun.CryptoHasher("sha256").update(payload).digest("hex"),
    });
    await Bun.write(
      path.join(directory, `page-${page}.json`),
      JSON.stringify({ id, page, payload })
    );
  }
  assert.equal(textBytes, capacityBytes);
  await Bun.write(
    path.join(directory, "manifest.json"),
    JSON.stringify(
      snapshotManifestSchema.parse({
        ...capacityIdentity,
        id,
        epoch: "88888888-8888-4888-8888-888888888888",
        version: 1,
        normalization: "pr0-search-v1-ucd17",
        revision: "10000",
        expiresAt: "2099-01-01T00:00:00.000Z",
        promptCount: capacityCount,
        pages,
      })
    )
  );
};
