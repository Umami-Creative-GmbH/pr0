// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Record the resident service group repeatedly during the declared load interval.
import type { CapacityServiceInstance } from "./capacity-service-fixture";

export interface CapacityResourceSample {
  recordedAt: string;
  stats: string;
  error: string;
}
export const monitorCapacityService = async (
  instance: CapacityServiceInstance,
  signal: AbortSignal,
  samples: CapacityResourceSample[]
) => {
  while (!signal.aborted) {
    const sample = {
      recordedAt: new Date().toISOString(),
      stats: "",
      error: "",
    };
    try {
      sample.stats = await instance.compose(
        "stats",
        "--no-stream",
        "--format",
        "json"
      );
    } catch (error) {
      sample.error = String(error);
    }
    samples.push(sample);
    await Bun.sleep(30_000);
  }
};
