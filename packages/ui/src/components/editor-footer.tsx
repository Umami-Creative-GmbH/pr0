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
}) => (
  <footer className="wf-dialog-foot">
    <VariableHint names={variableNames} />
    <span className="wf-grow" />
    <button
      className="wf-btn"
      disabled={saving}
      type="button"
      onClick={onCancel}
    >
      Cancel
    </button>
    <button className="wf-btn" type="button" onClick={onCopy}>
      Copy text
    </button>
    {onSaveAsNew ? (
      <button className="wf-btn" type="button" onClick={onSaveAsNew}>
        Save as new prompt
      </button>
    ) : null}
    <button
      className="wf-btn-accent"
      disabled={saving || saveDisabled}
      type="submit"
    >
      {retry ? "Retry" : "Save"}
    </button>
  </footer>
);
