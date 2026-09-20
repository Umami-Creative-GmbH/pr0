"use client";
import { useRef } from "react";

export const useLibraryDrafts = (onDirtyChange: (dirty: boolean) => void) => {
  const drafts = useRef({
    organization: false,
    tags: false,
    editor: false,
    action: false,
  });
  return (kind: keyof typeof drafts.current, dirty: boolean) => {
    drafts.current[kind] = dirty;
    onDirtyChange(Object.values(drafts.current).some(Boolean));
  };
};
