import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { useQueryClient } from "@tanstack/react-query";

export const useLibraryRefresh = (library: PrivateLibrary) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const scope = [client.baseUrl, library.instance.id, library.account.id];
  return async () => {
    // Refresh the selected snapshot before resetting lists can change selection.
    await queryClient.invalidateQueries({ queryKey: ["prompt", ...scope] });
    await queryClient.resetQueries({ queryKey: ["prompts", ...scope] });
    await queryClient.invalidateQueries({
      queryKey: ["organization", ...scope],
    });
    await queryClient.resetQueries({ queryKey: ["conflicts", ...scope] });
  };
};
