"use client";

import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { useLibraryKeyboard } from "../hooks/use-library-keyboard";

const themeKey = "pr0.theme";
let temporaryTheme: "light" | "dark" | undefined;
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener("pr0-theme", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("pr0-theme", listener);
  };
};
const readTheme = () => {
  if (temporaryTheme) {
    return temporaryTheme;
  }
  try {
    return localStorage.getItem(themeKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};
const serverTheme = () => "dark";

export const WayfinderShell = ({
  children,
  surface,
  actions,
  identity,
}: {
  children: ReactNode;
  surface: "web" | "desktop" | "launcher";
  actions?: ReactNode;
  identity?: string | null;
}) => {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const toggleTheme = () => {
    temporaryTheme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(themeKey, temporaryTheme);
      temporaryTheme = undefined;
    } catch {
      // Keep a working in-memory theme when browser storage is disabled.
    }
    window.dispatchEvent(new Event("pr0-theme"));
  };
  return (
    <div className="wf" data-theme={theme} data-surface={surface}>
      <header className="wf-chrome">
        <span className="wf-wordmark">
          pr<span>0</span>
        </span>
        {actions}
        <span className="wf-chrome-space" />
        {identity ? <span className="wf-identity">{identity}</span> : null}
        <button
          className="wf-theme"
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? (
            <Sun aria-hidden="true" size={16} />
          ) : (
            <Moon aria-hidden="true" size={16} />
          )}
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>
      {children}
    </div>
  );
};

export const LibraryWorkspace = ({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) => {
  const sidebarRef = useLibraryKeyboard();
  return (
    <div className="wf-workspace">
      <aside
        className="wf-sidebar"
        aria-label="Library navigation"
        ref={sidebarRef}
      >
        {sidebar}
      </aside>
      <div className="wf-detail">{children}</div>
    </div>
  );
};

export const EmptyDetail = () => (
  <div className="wf-empty">
    <span className="wf-eyebrow">Your prompt library</span>
    <h2>No prompt selected</h2>
    <p>
      Choose a prompt to read, edit or copy it. Create a prompt to start
      something new.
    </p>
  </div>
);
