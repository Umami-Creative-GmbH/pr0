"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Closes an open `<details>` menu on Escape or a pointer press outside it.
 * Pass the menu’s existing ref when another hook already owns one.
 */
export const useDismissable = (
  existing?: RefObject<HTMLDetailsElement | null>
) => {
  const own = useRef<HTMLDetailsElement>(null);
  const ref = existing ?? own;
  useEffect(() => {
    const close = (restoreFocus: boolean) => {
      const menu = ref.current;
      if (!menu?.open) {
        return;
      }
      menu.open = false;
      if (restoreFocus) {
        menu.querySelector("summary")?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !ref.current?.contains(event.target)
      ) {
        close(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        event.preventDefault();
        close(true);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref]);
  return ref;
};
