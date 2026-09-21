"use client";

import { useEffect, useEffectEvent, useState } from "react";

export const useQuickAccess = (available: boolean) => {
  const [open, setOpen] = useState(false);
  const keydown = useEffectEvent((event: KeyboardEvent) => {
    if (
      available &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "k" &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      setOpen(true);
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
};
