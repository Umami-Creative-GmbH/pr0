import { useTranslations } from "../hooks/use-translations";
import { VariableHint } from "./variable-hint";

export const EditorFooter = ({
  variableNames,
  saving,
  retry,
  saveDisabled = false,
  onCancel,
  onCopy,
  onSaveAsNew,
}: {
  variableNames: readonly string[];
  saving: boolean;
  retry: boolean;
  saveDisabled?: boolean;
  onCancel: () => void;
  onCopy: () => void;
  /** Present only after a conflict that a new prompt can resolve. */
  onSaveAsNew?: () => void;
}) => {
  const t = useTranslations();
  return (
    <footer className="wf-dialog-foot">
      <VariableHint names={variableNames} />
      <span className="wf-grow" />
      <button
        className="wf-btn"
        disabled={saving}
        type="button"
        onClick={onCancel}
      >
        {t("cancel")}
      </button>
      <button className="wf-btn" type="button" onClick={onCopy}>
        {t("copyText")}
      </button>
      {onSaveAsNew ? (
        <button className="wf-btn" type="button" onClick={onSaveAsNew}>
          {t("saveAsNewPrompt")}
        </button>
      ) : null}
      <button
        className="wf-btn-accent"
        disabled={saving || saveDisabled}
        type="submit"
      >
        {retry ? t("retry") : t("save")}
      </button>
    </footer>
  );
};
