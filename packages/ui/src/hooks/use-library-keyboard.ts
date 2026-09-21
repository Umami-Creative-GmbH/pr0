"use client";

import { useEffect, useRef } from "react";

const navigate = (event: KeyboardEvent) => {
  const { target } = event;
  if (
    !(target instanceof HTMLButtonElement) ||
    !Object.hasOwn(target.dataset, "promptRow") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return;
  }
  if (event.key === "Enter") {
    const copy = target.parentElement?.querySelector<HTMLButtonElement>(
      '[data-prompt-action="copy"]'
    );
    if (copy && !copy.disabled) {
      event.preventDefault();
      copy.click();
    }
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  if (!(event.currentTarget instanceof HTMLElement)) {
    return;
  }
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "[data-prompt-row]"
    ),
  ];
  const index = rows.indexOf(target);
  const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
  if (next && !next.disabled) {
    event.preventDefault();
    next.focus();
    next.click();
  }
};

export const useLibraryKeyboard = () => {
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    const slash = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented ||
        document.querySelector("dialog[open]")
      ) {
        return;
      }
      const { target } = event;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))
      ) {
        return;
      }
      const search = sidebar.current?.querySelector<HTMLInputElement>(
        'input[type="search"]'
      );
      if (search) {
        event.preventDefault();
        search.focus();
      }
    };
    const element = sidebar.current;
    element?.addEventListener("keydown", navigate);
    window.addEventListener("keydown", slash);
    return () => {
      window.removeEventListener("keydown", slash);
      element?.removeEventListener("keydown", navigate);
    };
  }, []);
  return sidebar;
};
