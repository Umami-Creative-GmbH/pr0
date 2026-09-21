import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  libraryScopeSchema,
  revisionSchema,
  searchNormalizationVersion,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { configuration } from "./config";
import { invalidPromptRequest, PromptFailureError } from "./prompt-errors";

const cursorSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  epoch: z.uuid(),
  version: z.literal(1),
  normalization: z.literal(searchNormalizationVersion),
  revision: revisionSchema,
});
export type ChangeScope = z.infer<typeof cursorSchema>;
export const snapshotRequired = () =>
  new PromptFailureError(
    {
      code: "snapshot_required",
      message:
        "The update checkpoint expired or changed. Retain local work while the library recovers.",
      retryable: false,
    },
    409
  );
const sign = (payload: string) =>
  createHmac("sha256", configuration().authSecret)
    .update(`changes-v1:${payload}`)
    .digest("base64url");
export const encodeChangeCursor = (scope: ChangeScope) => {
  const payload = Buffer.from(JSON.stringify(scope)).toString("base64url");
  return `${payload}.${sign(payload)}`;
};
export const decodeChangeCursor = (cursor: string, scope: ChangeScope) => {
  const parts = cursor.split(".");
  const [payload = "", signature = ""] = parts;
  const expected = sign(payload);
  if (
    parts.length !== 2 ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw invalidPromptRequest();
  }
  const parsed = cursorSchema.safeParse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"))
  );
  if (!parsed.success) {
    throw snapshotRequired();
  }
  const value = parsed.data;
  if (
    value.instanceId !== scope.instanceId ||
    value.accountId !== scope.accountId
  ) {
    throw invalidPromptRequest();
  }
  if (
    value.epoch !== scope.epoch ||
    BigInt(value.revision) > BigInt(scope.revision)
  ) {
    throw snapshotRequired();
  }
  return value.revision;
};
