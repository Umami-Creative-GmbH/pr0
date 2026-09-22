import type {
  LifecycleAction,
  LocalPrompt,
} from "@pr0/api-contract/local-prompts";
import { PromptDeleteDialog } from "@pr0/ui/components/prompt-delete-dialog";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useState } from "react";

export const LifecycleActions = ({
  value,
  disabled,
  onAction,
}: {
  value: LocalPrompt;
  disabled: boolean;
  onAction: (value: LocalPrompt, action: LifecycleAction) => void;
}) => {
  const t = useTranslations();

  const [deleting, setDeleting] = useState<LocalPrompt>();
  const { prompt } = value;
  return (
    <div className="[&>button[aria-pressed=true]]:bg-secondary flex flex-wrap gap-3 [&>button]:rounded [&>button]:border [&>button]:px-3 [&>button]:py-2 [&>button:disabled]:opacity-50">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={prompt.favorite}
        onClick={() =>
          onAction(value, { kind: "favorite", value: !prompt.favorite })
        }
      >
        {t("favorite")}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onAction(value, { kind: "archive", value: !prompt.archived })
        }
      >
        {prompt.archived ? t("restore") : t("archive")}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onAction(value, { kind: "duplicate", copyId: crypto.randomUUID() })
        }
      >
        {t("duplicate")}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setDeleting(value)}
      >
        {t("deletePermanently")}
      </button>
      {deleting ? (
        <PromptDeleteDialog
          title={deleting.prompt.title}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => {
            onAction(deleting, { kind: "delete", confirmed: true });
            setDeleting(undefined);
          }}
        />
      ) : null}
    </div>
  );
};
