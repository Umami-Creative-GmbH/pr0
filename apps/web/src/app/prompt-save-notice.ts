import type { MutationReceipt } from "@pr0/api-contract/prompts";

export const promptSaveNotice = (
  receipt: MutationReceipt,
  savedMessage = "Saved to server."
) =>
  [
    savedMessage,
    receipt.conflict
      ? "Competing text was preserved in an independent conflict copy."
      : "",
    receipt.organizationNotice,
  ]
    .filter(Boolean)
    .join(" ");
