import { promptLimits } from "@pr0/api-contract/prompts";

export const OrganizationCapacity = ({
  count,
  limit,
  plural,
  singular,
  textBytes,
  loading,
  error,
  onRetry,
}: {
  count: number;
  limit: number;
  plural: string;
  singular: string;
  textBytes: number;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) => (
  <>
    <p>
      {count} / {limit} {plural.toLowerCase()} ·{" "}
      {(textBytes / 1_048_576).toFixed(2)} / 100 MiB library text
    </p>
    <p className="text-muted-foreground text-sm">
      Counts are library-wide, including the archive, for the available
      snapshot.
    </p>
    {count >= limit * promptLimits.warningRatio ? (
      <output>
        Your library is at or above 90% of its {limit.toLocaleString("en-US")}{" "}
        {singular.toLowerCase()} limit.
      </output>
    ) : null}
    {textBytes >= promptLimits.libraryBytes * promptLimits.warningRatio ? (
      <output>
        Your library is at or above 90% of its 100 MiB text limit.
      </output>
    ) : null}
    {loading ? <output>Loading {plural.toLowerCase()}…</output> : null}
    {error ? (
      <div role="alert">
        {error}{" "}
        <button className="wf-btn" type="button" onClick={onRetry}>
          Retry {plural.toLowerCase()}
        </button>
      </div>
    ) : null}
  </>
);
