import { createPromptClient } from "@pr0/api-client/prompts";
import type {
  CreatePrompt,
  MutationEnvelope,
  PromptText,
  Prompt,
  UpdatePrompt,
} from "@pr0/api-contract/prompts";
import { promptTextFields } from "@pr0/api-contract/prompts";

import { socialBrowser } from "./email-change-fixture";
import { origin, post } from "./http-fixture";
import { libraryFor } from "./social-fixture";

const defaultText: PromptText = {
  title: "Writing helper",
  description: "",
  content: "Hello",
};
export const promptOperation = (
  desired: PromptText = defaultText
): CreatePrompt => ({
  operationId: crypto.randomUUID(),
  promptId: crypto.randomUUID(),
  kind: "prompt.create",
  baseRevision: "0",
  dependsOn: [],
  desired,
});
export const promptBrowser = async () => {
  const browser = await socialBrowser();
  const library = await libraryFor(browser.Cookie);
  const identity = {
    protocolVersion: 1 as const,
    instanceId: library.instance.id,
    accountId: library.account.id,
    epoch: library.epoch,
    installationId: crypto.randomUUID(),
  };
  const mutate = (
    operations: MutationEnvelope["operations"],
    overrides: Partial<MutationEnvelope> = {}
  ) =>
    post(
      "/api/v1/sync/mutations",
      { ...identity, operations, ...overrides },
      { Cookie: browser.Cookie }
    );
  const get = (path: string) =>
    fetch(`${origin}/api/v1/library/prompts${path}`, {
      headers: { Cookie: browser.Cookie },
    });
  return { ...browser, identity, mutate, get };
};

export const promptClient = (Cookie: string) =>
  createPromptClient(origin, (url, init) => {
    const headers = new Headers(init.headers);
    headers.set("Cookie", Cookie);
    headers.set("Origin", origin);
    return fetch(url, { ...init, headers });
  });
export const promptEdit = (
  base: Prompt,
  desired: PromptText
): UpdatePrompt => ({
  operationId: crypto.randomUUID(),
  kind: "prompt.update",
  promptId: base.id,
  baseRevision: base.revision,
  dependsOn: [],
  changedFields: promptTextFields.filter(
    (field) => base[field] !== desired[field]
  ),
  base: {
    title: base.title,
    description: base.description,
    content: base.content,
  },
  desired,
});

export const promptState = (
  base: Prompt,
  field: "favorite" | "archived",
  value: boolean
): UpdatePrompt => ({
  ...promptEdit(base, {
    title: base.title,
    description: base.description,
    content: base.content,
  }),
  base: {
    title: base.title,
    description: base.description,
    content: base.content,
    [field]: base[field],
  },
  desired: {
    title: base.title,
    description: base.description,
    content: base.content,
    [field]: value,
  },
  changedFields: base[field] === value ? [] : [field],
});
