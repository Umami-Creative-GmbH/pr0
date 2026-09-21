// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Bounded event reads share a short consistent transaction; no transaction spans waiting.
import "server-only";
import {
  changeEventSchema,
  changeLimits,
  changePageSchema,
} from "@pr0/api-contract/changes";
import type { ChangeRequest } from "@pr0/api-contract/changes";

import type { BrowserAccount } from "./browser-proof";
import {
  decodeChangeCursor,
  encodeChangeCursor,
  snapshotRequired,
} from "./change-cursor";
import type { ChangeScope } from "./change-cursor";
import { database } from "./database";
import { lockLibrary } from "./prompt-store";

export const readChanges = (account: BrowserAccount, input: ChangeRequest) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, account);
    const scope: ChangeScope = {
      instanceId: library.instance_id,
      accountId: account.accountId,
      epoch: library.recovery_epoch,
      revision: library.revision,
      version: 1,
      normalization: "pr0-search-v1-ucd17",
    };
    const fromRevision = input.cursor
      ? decodeChangeCursor(input.cursor, scope)
      : (input.after ?? scope.revision);
    if (
      (input.epoch && input.epoch !== scope.epoch) ||
      BigInt(fromRevision) > BigInt(scope.revision)
    ) {
      throw snapshotRequired();
    }
    let revision = fromRevision;
    const changes = [];
    let size = 4096;
    while (
      revision !== scope.revision &&
      changes.length < changeLimits.events
    ) {
      const [row] =
        await tx`SELECT revision::text,payload FROM library_change WHERE instance_id=${scope.instanceId} AND account_id=${scope.accountId} AND revision=${(BigInt(revision) + 1n).toString()}::bigint AND accepted_at >= clock_timestamp() - interval '90 days'`;
      if (!row?.payload) {
        throw snapshotRequired();
      }
      const bytes = Buffer.byteLength(row.payload) + 1;
      if (size + bytes > changeLimits.pageBytes) {
        break;
      }
      const event = changeEventSchema.parse(JSON.parse(row.payload));
      changes.push(event);
      size += bytes;
      ({ revision } = row);
    }
    return changePageSchema.parse({
      ...scope,
      fromRevision,
      revision,
      headRevision: scope.revision,
      changes,
      hasMore: revision !== scope.revision,
      cursor: encodeChangeCursor({ ...scope, revision }),
    });
  });
