import type {
  CreatePrompt,
  MutationEnvelope,
  PromptText,
} from "@pr0/api-contract/prompts";

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
    operations: CreatePrompt[],
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
