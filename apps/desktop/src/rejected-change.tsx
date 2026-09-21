import type { UploadStatus } from "@pr0/api-contract/local-prompts";
import type { PromptError } from "@pr0/api-contract/prompts";

import { uploadFailureMessage } from "./upload-status";

const resources = {
  promptCount: "prompt count",
  textBytes: "total library text",
  collectionCount: "collection count",
  tagCount: "tag count",
  tagsPerPrompt: "tags per prompt",
};
export const CapacityDetails = ({
  failure,
}: {
  failure?: PromptError | null;
}) => (
  <>
    {failure?.resource ? (
      <p>Limiting resource: {resources[failure.resource]}.</p>
    ) : null}
    {failure?.usage ? (
      <p>
        Server usage: {failure.usage.promptCount} prompts;{" "}
        {failure.usage.textBytes} bytes of library text.
      </p>
    ) : null}
  </>
);
export const RejectedChange = ({
  entry,
  deleting,
}: {
  entry: UploadStatus["errors"][number];
  deleting: boolean;
}) => (
  <>
    <p>{uploadFailureMessage(entry.code)}</p>
    <CapacityDetails failure={entry.failure} />
    {entry.code === "quota_exceeded" ? (
      <p>
        {deleting
          ? "Deletion remains pending. The server original was not deleted because its unseen edit could not be preserved."
          : "This variant is retained on this device; required preservation has not been saved to the server."}
      </p>
    ) : null}
  </>
);
