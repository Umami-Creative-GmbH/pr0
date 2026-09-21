import { createPromptClient } from "@pr0/api-client/prompts";
import type {
  CreatePrompt,
  MutationEnvelope,
  PromptText,
  Prompt,
  UpdatePrompt,
  DeletePrompt,
} from "@pr0/api-contract/prompts";
import { promptTextFields, promptErrorSchema } from "@pr0/api-contract/prompts";

import { socialBrowser } from "./email-change-fixture";
import { origin, post } from "./http-fixture";
import { libraryFor } from "./social-fixture";

const defaultText: PromptText = {
  title: "Writing helper",
  description: "",
  content: "Hello",
};
export const promptDeletion = (
  prompt: Pick<Prompt, "id" | "revision">
): DeletePrompt => ({
  kind: "prompt.delete",
  operationId: crypto.randomUUID(),
  promptId: prompt.id,
  baseRevision: prompt.revision,
  dependsOn: [],
});
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
  createPromptClient(origin, async (url, init) => {
    const headers = new Headers(init.headers);
    headers.set("Cookie", Cookie);
    headers.set("Origin", origin);
    const deadline = Date.now() + 120_000;
    // oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Capacity fixtures await search preparation and its bounded read-admission retries before asserting results.
    while (true) {
      const response = await fetch(url, { ...init, headers });
      if (
        response.status !== 503 ||
        init.method !== "GET" ||
        Date.now() >= deadline
      ) {
        return response;
      }
      const failure = promptErrorSchema.safeParse(
        await response.clone().json()
      );
      if (
        !failure.success ||
        !failure.data.retryable ||
        (failure.data.code !== "search_preparing" &&
          failure.data.code !== "temporarily_unavailable")
      ) {
        return response;
      }
      await Bun.sleep((failure.data.retryAfter ?? 1) * 1000);
    }
    // oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop
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
