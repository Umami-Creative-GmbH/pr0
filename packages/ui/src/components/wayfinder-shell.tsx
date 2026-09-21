"use client";

import { Command, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import {
  createContext,
  use,
  useState,
  useSyncExternalStore,
  useMemo,
} from "react";
import { createPortal } from "react-dom";

import { useDismissable } from "../hooks/use-dismissable";
import { useLibraryKeyboard } from "../hooks/use-library-keyboard";
import { initials } from "../lib/present";

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

interface AppBarSlots {
  status: HTMLElement | null;
  controls: HTMLElement | null;
}
const StatusSlot = createContext<AppBarSlots>({ status: null, controls: null });

/**
 * Renders real library state into the app bar from wherever that state lives,
 * so the shell does not need to own synchronization data.
 */
export const AppBarStatus = ({
  children,
  slot = "status",
}: {
  children: ReactNode;
  /** `controls` sits after the surface entry point, before theme and account. */
  slot?: keyof AppBarSlots;
}) => {
  const target = use(StatusSlot)[slot];
  return target ? createPortal(children, target) : null;
};

const useTheme = () => useSyncExternalStore(subscribe, readTheme, serverTheme);

/** Switches the theme shared by every pr0 window of this origin. */
export const ThemeToggle = ({ size = "md" }: { size?: "sm" | "md" }) => {
  const theme = useTheme();
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
    <button
      className="wf-icon-btn"
      data-size={size}
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? (
        <Sun aria-hidden="true" size={15} />
      ) : (
        <Moon aria-hidden="true" size={15} />
      )}
    </button>
  );
};

export const Wordmark = ({ size }: { size?: "lg" }) => (
  <span className="wf-wordmark" data-size={size}>
    pr<span>0</span>
  </span>
);

/** A disclosure in the app bar whose content floats below it. */
export const AppMenu = ({
  label,
  summary,
  variant,
  children,
}: {
  label?: string;
  summary: ReactNode;
  /** `sync` styles the summary as the app bar's status indicator. */
  variant?: "sync";
  children: ReactNode;
}) => {
  const ref = useDismissable();
  return (
    <details className="wf-menu" ref={ref}>
      <summary
        aria-label={label}
        className={variant === "sync" ? "wf-sync" : undefined}
      >
        {summary}
      </summary>
      <div className="wf-popover">{children}</div>
    </details>
  );
};

export const WayfinderShell = ({
  children,
  surface,
  actions,
  status,
  identity,
  menu,
}: {
  children: ReactNode;
  surface: "web" | "desktop" | "launcher";
  /** Surface entry point: browser quick access or the native launcher shortcut. */
  actions?: ReactNode;
  /** Real account, save and synchronization state. */
  status?: ReactNode;
  identity?: string | null;
  /** Account menu content shown beneath the identity. */
  menu?: ReactNode;
}) => {
  const theme = useTheme();
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  const [controlsSlot, setControlsSlot] = useState<HTMLElement | null>(null);
  const slots = useMemo(
    () => ({ status: statusSlot, controls: controlsSlot }),
    [statusSlot, controlsSlot]
  );
  const desktop = surface === "desktop";
  return (
    <div className="wf" data-theme={theme} data-surface={surface}>
      <header className="wf-appbar" data-surface={surface}>
        <Wordmark />
        {desktop ? null : actions}
        <span className="wf-grow" />
        <div className="contents" ref={setStatusSlot}>
          {status}
        </div>
        {desktop ? actions : null}
        <div className="contents" ref={setControlsSlot} />
        <ThemeToggle />
        {identity || menu ? (
          <AppMenu
            label="Account menu"
            summary={
              <span className="wf-avatar" aria-hidden="true">
                {initials(identity)}
              </span>
            }
          >
            {identity ? (
              <p className="wf-identity">
                <span className="wf-eyebrow">Signed in as</span>
                <strong title={identity}>{identity}</strong>
              </p>
            ) : null}
            {menu}
          </AppMenu>
        ) : null}
      </header>
      <StatusSlot value={slots}>{children}</StatusSlot>
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

export const EmptyDetail = ({ hint }: { hint: string }) => (
  <div className="wf-empty">
    <Command aria-hidden="true" size={30} />
    <h2>No prompt selected</h2>
    <p>{hint}</p>
  </div>
);
