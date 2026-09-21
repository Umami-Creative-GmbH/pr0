import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { useQueryClient } from "@tanstack/react-query";

import { refreshLibrary } from "./refresh-library";

export const useLibraryRefresh = (library: PrivateLibrary) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const scope = [client.baseUrl, library.instance.id, library.account.id];
  return async () => {
    window.dispatchEvent(
      new CustomEvent("pr0:library-saved", { detail: scope.join(":") })
    );
    try {
      await refreshLibrary(queryClient, scope);
    } catch {
      // A read failure is shown by its query and the live coordinator; the save already succeeded.
    }
  };
};
