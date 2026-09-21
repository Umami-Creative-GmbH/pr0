"use client";

import { useEffect, useRef } from "react";

const copySelected = (event: KeyboardEvent, selected?: HTMLButtonElement) => {
  const copy = selected?.parentElement?.querySelector<HTMLButtonElement>(
    '[data-prompt-action="copy"]'
  );
  if (copy && !copy.disabled) {
    event.preventDefault();
    copy.click();
  }
};

const blocked = (event: KeyboardEvent) =>
  event.altKey ||
  event.defaultPrevented ||
  Boolean(document.querySelector("dialog[open]"));

const navigate = (event: KeyboardEvent) => {
  const { target, currentTarget } = event;
  if (
    !(target instanceof HTMLElement) ||
    !(currentTarget instanceof HTMLElement) ||
    blocked(event)
  ) {
    return;
  }
  const fromSearch = target.matches("input[data-library-search]");
  const fromRow = target.matches("button[data-prompt-row]");
  if (!fromSearch && !fromRow) {
    return;
  }
  const rows = [
    ...currentTarget.querySelectorAll<HTMLButtonElement>("[data-prompt-row]"),
  ];
  const selected = fromRow
    ? rows.find((row) => row === target)
    : rows.find((row) => row.getAttribute("aria-pressed") === "true");
  if (event.key === "Enter" && (fromRow || event.ctrlKey || event.metaKey)) {
    copySelected(event, selected);
    return;
  }
  if (
    event.ctrlKey ||
    event.metaKey ||
    (event.key !== "ArrowDown" && event.key !== "ArrowUp")
  ) {
    return;
  }
  const index = selected ? rows.indexOf(selected) : -1;
  const next =
    rows[
      fromSearch
        ? Math.max(index, 0)
        : index + (event.key === "ArrowDown" ? 1 : -1)
    ];
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
        "input[data-library-search]"
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
