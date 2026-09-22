import type { MutationReceipt } from "@pr0/api-contract/prompts";
import { translate } from "@pr0/ui/lib/i18n";

export const promptSaveNotice = (
  receipt: MutationReceipt,
  savedMessage = translate("savedToServer")
) =>
  [
    savedMessage,
    receipt.conflict
      ? translate("competingTextWasPreservedInAnIndependentConflictCopy")
      : "",
    receipt.organizationNotice,
  ]
    .filter(Boolean)
    .join(" ");
