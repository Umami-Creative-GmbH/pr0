import { useHealth } from "@pr0/api-client/health";
import { StarterScreen } from "@pr0/ui/components/starter-screen";

export const App = () => {
  const health = useHealth();
  return (
    <StarterScreen
      isFetching={health.isFetching}
      onRetry={() => {
        void health.refetch();
      }}
      status={health.status}
    />
  );
};
