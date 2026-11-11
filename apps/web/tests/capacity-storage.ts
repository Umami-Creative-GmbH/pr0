import type { CapacityServiceInstance } from "./capacity-service-fixture";

/** Count the complete data trees, including WAL and scratch. */
export const capacityStorage = async (instance: CapacityServiceInstance) => {
  const postgres = async (service: string) =>
    await instance.compose(
      "exec",
      "-T",
      service,
      "sh",
      "-c",
      'du -sb "$PGDATA"'
    );
  const [primary, search, temporary] = await Promise.all([
    postgres("database"),
    instance.compose("exec", "-T", "web", "du", "-sb", "/var/lib/pr0-search"),
    instance.compose("exec", "-T", "web", "du", "-sb", "/tmp"),
  ]);
  return {
    recordedAt: new Date().toISOString(),
    primary,
    search,
    temporary,
    classification:
      "Apparent bytes of service data directories, including PostgreSQL WAL/global metadata and web scratch; excludes container images, Docker filesystem allocation and backup volume. Shared disk has no enforced 64-GiB quota.",
  };
};
