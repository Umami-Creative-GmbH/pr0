import { createContext, useContext, useLayoutEffect } from "react";

export interface ResidentEditor {
  hasChanges: () => boolean;
  pending: () => Promise<boolean> | null;
  save: () => Promise<boolean>;
}
export const ResidentEditorContext = createContext<
  ((editor: ResidentEditor) => () => void) | null
>(null);

export const useResidentEditor = (editor: ResidentEditor) => {
  const registration = useContext(ResidentEditorContext);
  useLayoutEffect(() => {
    if (!registration) {
      return;
    }
    return registration(editor);
  }, [editor, registration]);
};
