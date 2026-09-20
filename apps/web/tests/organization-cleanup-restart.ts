import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";
import { tagOperation } from "./tag-fixture";

export const organizationRestartFixture = async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const source = tagOperation("Restart source");
  const target = tagOperation("Restart target");
  const create = promptOperation();
  await account.mutate([
    source,
    target,
    { ...create, desired: { ...create.desired, tagIds: [source.tagId] } },
  ]);
  const snapshot = await client.getOrganization();
  const merge = {
    ...account.identity,
    operations: [
      {
        kind: "tag.merge" as const,
        operationId: crypto.randomUUID(),
        tagId: source.tagId,
        targetId: target.tagId,
        baseRevision: snapshot.revision,
        dependsOn: [],
      },
    ],
  };
  const receipt = await client.mutatePrompts(merge);
  const afterMerge = await client.getOrganization();
  await client.mutatePrompts({
    ...account.identity,
    operations: [
      {
        kind: "tag.delete",
        operationId: crypto.randomUUID(),
        tagId: target.tagId,
        baseRevision: afterMerge.revision,
        dependsOn: [],
      },
    ],
  });
  return {
    Cookie: account.Cookie,
    merge,
    receipt,
    prompt: await client.getPrompt(create.promptId),
    states: await client.getOrganizationStates([source.tagId, target.tagId]),
    review: await client.getOrganizationReview(
      merge.operations[0]?.operationId ?? ""
    ),
  };
};
