/** PROTOTYPE (issue #9) — copy confirmation and failure notice. */

import { useTranslate } from "@tolgee/react";
import { Check, TriangleAlert } from "lucide-react";

export type Toast =
  | { tone: "success"; label: string; detail: string }
  | { tone: "error"; label: string; detail: string; onRetry: () => void };

export const PrototypeToast = ({ toast }: { toast: Toast }) => {
  const { t } = useTranslate();

  return (
    <output className="pr0-toast" data-tone={toast.tone}>
      {toast.tone === "success" ? (
        <Check
          aria-hidden="true"
          size={17}
          style={{ color: "var(--green-500)" }}
        />
      ) : (
        <TriangleAlert aria-hidden="true" size={17} />
      )}
      <span className="pr0-toast-label">{toast.label}</span>
      <span className="pr0-toast-detail">{toast.detail}</span>
      {toast.tone === "error" ? (
        <button
          onClick={() => {
            toast.onRetry();
          }}
          type="button"
        >
          {t("toast.retry")}
        </button>
      ) : null}
    </output>
  );
};
