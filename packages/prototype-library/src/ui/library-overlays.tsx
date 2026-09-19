/** PROTOTYPE (issue #9) — the launcher, editor, variables and delete modals. */

import { useTranslate } from "@tolgee/react";

import type { Library, Prompt, PromptId } from "../domain/types";
import { ConfirmDelete, VariablesDialog } from "./dialogs";
import { LauncherPanel } from "./launcher-panel";
import { Overlay } from "./overlay";
import type { EditorDraft } from "./prompt-editor";
import { PromptEditor } from "./prompt-editor";

export interface EditorTarget {
  prompt: Prompt | null;
  initialTitle: string;
}

export interface LibraryOverlaysProps {
  library: Library;
  /** Only drawn when the launcher is an in-page overlay. */
  launcherOpen: boolean;
  onLauncherClose: () => void;
  onLauncherCopy: (
    promptId: PromptId,
    variableValues?: Record<string, string>
  ) => Promise<void>;
  onLauncherOpenPrompt: (promptId: PromptId) => void;

  editor: EditorTarget | null;
  onEditorClose: () => void;
  onEditorSave: (draft: EditorDraft) => void;

  variablesFor: Prompt | null;
  onVariablesClose: () => void;
  onVariablesCopy: (prompt: Prompt, values: Record<string, string>) => void;

  deleteFor: Prompt | null;
  onDeleteClose: () => void;
  onDeleteConfirm: (prompt: Prompt) => void;
}

export const LibraryOverlays = ({
  library,
  launcherOpen,
  onLauncherClose,
  onLauncherCopy,
  onLauncherOpenPrompt,
  editor,
  onEditorClose,
  onEditorSave,
  variablesFor,
  onVariablesClose,
  onVariablesCopy,
  deleteFor,
  onDeleteClose,
  onDeleteConfirm,
}: LibraryOverlaysProps) => {
  const { t } = useTranslate();

  return (
    <>
      {launcherOpen ? (
        <Overlay
          align="top"
          label={t("chrome.quickAccess")}
          onClose={onLauncherClose}
        >
          <LauncherPanel
            library={library}
            onClose={onLauncherClose}
            onCopy={onLauncherCopy}
            onOpenPrompt={onLauncherOpenPrompt}
          />
        </Overlay>
      ) : null}

      {editor === null ? null : (
        <Overlay
          label={
            editor.prompt === null
              ? t("editor.headline.new")
              : t("editor.eyebrow.edit")
          }
          onClose={onEditorClose}
        >
          <PromptEditor
            initialTitle={editor.initialTitle}
            library={library}
            onCancel={onEditorClose}
            onSave={onEditorSave}
            prompt={editor.prompt}
          />
        </Overlay>
      )}

      {variablesFor === null ? null : (
        <Overlay label={t("vars.eyebrow")} onClose={onVariablesClose}>
          <VariablesDialog
            onCancel={onVariablesClose}
            onCopy={(values) => onVariablesCopy(variablesFor, values)}
            prompt={variablesFor}
          />
        </Overlay>
      )}

      {deleteFor === null ? null : (
        <Overlay label={t("confirm.delete.title")} onClose={onDeleteClose}>
          <ConfirmDelete
            onCancel={onDeleteClose}
            onConfirm={() => onDeleteConfirm(deleteFor)}
            prompt={deleteFor}
          />
        </Overlay>
      )}
    </>
  );
};
