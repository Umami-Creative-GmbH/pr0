import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { DeletionTrust } from "@pr0/api-contract/deletions";
import { libraryScopeSchema } from "@pr0/api-contract/prompts";
import type { QueryClient } from "@tanstack/react-query";

export const deletedPartition = (
  library: PrivateLibrary | null | undefined,
  identity: DeletionTrust
) =>
  library?.account.id === identity.accountId &&
  library.instance.id === identity.instanceId;

const deletedQuery = (
  key: readonly unknown[],
  baseUrl: string,
  identity: DeletionTrust
) => {
  const [kind, scope] = key;
  if (
    kind === "organization-review" ||
    kind === "organization-review-names" ||
    kind === "organization-impact"
  ) {
    // These review queries live in the provider's per-origin cache.
    const parsed = libraryScopeSchema.safeParse(scope);
    return (
      parsed.success &&
      parsed.data.instanceId === identity.instanceId &&
      parsed.data.accountId === identity.accountId
    );
  }
  return (
    scope === baseUrl &&
    ((key[2] === identity.instanceId && key[3] === identity.accountId) ||
      ((key[0] === "account-sessions" ||
        key[0] === "account-settings" ||
        key[0] === "login-methods") &&
        key[2] === identity.accountId))
  );
};

export const clearDeletedAccountCache = async (
  queryClient: QueryClient,
  baseUrl: string,
  identity: DeletionTrust
) => {
  const partition = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      deletedQuery(query.queryKey, baseUrl, identity),
  };
  await queryClient.cancelQueries(partition);
  queryClient.removeQueries(partition);
  const accountKey = ["account-library", baseUrl];
  const currentDeleted = () =>
    deletedPartition(
      queryClient.getQueryData<PrivateLibrary>(accountKey),
      identity
    );
  if (!currentDeleted()) {
    return false;
  }
  await queryClient.cancelQueries({ queryKey: accountKey, exact: true });
  // Recheck after cancellation: an account switch can finish during any await.
  if (!currentDeleted()) {
    return false;
  }
  queryClient.removeQueries({ queryKey: accountKey, exact: true });
  return true;
};
