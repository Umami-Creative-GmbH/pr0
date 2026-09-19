/**
 * PROTOTYPE (issue #9) — the outer frame: theme, language, surface switching
 * and the prototype tools used to drive failure states during the session.
 */

"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { ArrowRight, Globe, KeyRound, Moon, Sun } from "lucide-react";
import { useState } from "react";

import type { ClipboardWriter } from "../domain/copy";
import type { Library } from "../domain/types";
import type { LanguageTag, TolgeeOptions } from "../i18n/tolgee";
import {
  isLanguageTag,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
} from "../i18n/tolgee";
import { PrototypeI18nProvider } from "./i18n-provider";
import { LibraryApp } from "./library-app";

export type Surface = "desktop" | "web" | "auth";

export interface PrototypeShellProps {
  library: Library;
  onLibraryChange: (next: Library) => void;
  clipboard: ClipboardWriter;
  /** Stable "now" so relative dates do not drift during a session. */
  now: number;
  initialSurface?: Surface;
  /** The desktop app pins its surface. */
  fixedSurface?: boolean;
  /** True when a native Tauri window hosts the launcher. */
  launcherIsNative?: boolean;
  onOpenNativeLauncher?: () => void;
  /**
   * Which global shortcut registered. `null` means none could be claimed;
   * omit it entirely on surfaces that have no global shortcut (the browser).
   */
  shortcutLabel?: string | null;
  /** Lets the host force clipboard failures without editing code. */
  onClipboardFailureChange?: (fail: boolean) => void;
  clipboardFails?: boolean;
  tolgeeOptions?: TolgeeOptions;
}

const SURFACES: Surface[] = ["desktop", "web", "auth"];

const AuthSurface = ({ onEnter }: { onEnter: () => void }) => {
  const { t } = useTranslate();

  return (
    <div className="pr0-auth">
      <div className="pr0-auth-hero">
        <div className="pr0-auth-glow" />
        <div
          className="pr0-wordmark"
          style={{ position: "relative", fontSize: 34, color: "#fff" }}
        >
          pr
          <span>0</span>
        </div>
        <div
          style={{
            position: "relative",
            display: "grid",
            gap: 22,
            maxWidth: 380,
          }}
        >
          <span
            className="pr0-eyebrow"
            style={{ color: "var(--pink-500)", fontSize: 12 }}
          >
            {t("hero.eyebrow")}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 38,
              lineHeight: 1.08,
              letterSpacing: "-.03em",
              fontWeight: 600,
            }}
          >
            {t("hero.headline")}
          </span>
          <span style={{ fontSize: 15, lineHeight: 1.62, color: "#A8B4CC" }}>
            {t("hero.subline")}
          </span>
          <span className="pr0-mono" style={{ fontSize: 12, color: "#A8B4CC" }}>
            {t("hero.keys")}
          </span>
        </div>
        <div className="pr0-rainbow" />
      </div>

      <div className="pr0-auth-form">
        <div style={{ display: "grid", gap: 8 }}>
          <span
            className="pr0-eyebrow"
            style={{ color: "var(--pink-500)", fontSize: 12 }}
          >
            {t("auth.eyebrow")}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 30,
              letterSpacing: "-.03em",
              fontWeight: 600,
            }}
          >
            {t("auth.headline")}
          </span>
        </div>

        <label className="pr0-field">
          <span>{t("auth.email")}</span>
          <input
            className="pr0-input"
            defaultValue="jana@umami-creative.de"
            readOnly
            type="email"
          />
        </label>

        <label className="pr0-field">
          <span>{t("auth.password")}</span>
          <input
            className="pr0-input"
            defaultValue="prototype"
            readOnly
            type="password"
          />
        </label>

        <button
          className="pr0-accent"
          onClick={onEnter}
          style={{ height: 48 }}
          type="button"
        >
          {t("auth.submit")}
          <ArrowRight aria-hidden="true" size={16} />
        </button>

        <span className="pr0-rule">{t("auth.or")}</span>

        <button
          className="pr0-pill"
          onClick={onEnter}
          style={{ height: 48, justifyContent: "center" }}
          type="button"
        >
          <KeyRound aria-hidden="true" size={17} />
          {t("auth.passkey")}
        </button>

        <span
          style={{ fontSize: 13, color: "var(--app-ink-3)", lineHeight: 1.6 }}
        >
          {`${t("auth.noAccountQuestion")} ${t("auth.createAccount")} — ${t("auth.noAccountBenefit")}`}
        </span>
      </div>
    </div>
  );
};

const ShellInner = ({
  library,
  onLibraryChange,
  clipboard,
  now,
  initialSurface = "desktop",
  fixedSurface = false,
  launcherIsNative = false,
  onOpenNativeLauncher,
  shortcutLabel,
  onClipboardFailureChange,
  clipboardFails = false,
}: Omit<PrototypeShellProps, "tolgeeOptions">) => {
  const { t } = useTranslate();
  const tolgee = useTolgee(["language"]);
  const language = tolgee.getLanguage() ?? "de";

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [launcherOpen, setLauncherOpen] = useState(false);

  const statusNote = (() => {
    if (shortcutLabel === undefined) {
      return surface === "web" ? t("shortcut.simulated") : undefined;
    }
    return shortcutLabel === null
      ? t("shortcut.none")
      : t("shortcut.registered", { shortcut: shortcutLabel });
  })();

  const openLauncher = (open: boolean) => {
    if (open && launcherIsNative) {
      onOpenNativeLauncher?.();
      return;
    }
    setLauncherOpen(open);
  };

  return (
    <div className="pr0 pr0-shell" data-theme={theme}>
      <div className="pr0-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="pr0-wordmark">
            pr
            <span>0</span>
          </span>
          <span className="pr0-eyebrow" style={{ fontSize: 12 }}>
            {t("prototype.badge")}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {fixedSurface
            ? null
            : SURFACES.map((candidate) => (
                <button
                  className="pr0-pill"
                  data-active={surface === candidate}
                  key={candidate}
                  onClick={() => setSurface(candidate)}
                  type="button"
                >
                  {t(`prototype.surface.${candidate}`)}
                </button>
              ))}

          <label className="pr0-pill" style={{ textTransform: "none" }}>
            <Globe aria-hidden="true" size={14} />
            <span className="pr0-visually-hidden">
              {t("prototype.language")}
            </span>
            <select
              onChange={(event) => {
                const next = event.target.value;
                if (isLanguageTag(next)) {
                  void tolgee.changeLanguage(next);
                }
              }}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                letterSpacing: "normal",
              }}
              value={language}
            >
              {SUPPORTED_LANGUAGES.map((tag: LanguageTag) => (
                <option key={tag} value={tag}>
                  {LANGUAGE_LABELS[tag]}
                </option>
              ))}
            </select>
          </label>

          <button
            className="pr0-pill"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            type="button"
          >
            {theme === "dark" ? (
              <Sun aria-hidden="true" size={15} />
            ) : (
              <Moon aria-hidden="true" size={15} />
            )}
            {theme === "dark"
              ? t("prototype.theme.toLight")
              : t("prototype.theme.toDark")}
          </button>
        </div>
      </div>

      <div
        className="pr0-stage"
        style={
          surface === "auth" ? { height: "auto", minHeight: 640 } : undefined
        }
      >
        {surface === "auth" ? (
          <AuthSurface onEnter={() => setSurface("desktop")} />
        ) : (
          <LibraryApp
            clipboard={clipboard}
            launcherIsNative={launcherIsNative}
            launcherOpen={launcherOpen}
            library={library}
            now={now}
            onLauncherOpenChange={openLauncher}
            onLibraryChange={onLibraryChange}
            statusNote={statusNote}
            surface={surface}
          />
        )}
      </div>

      <div className="pr0-footnote">
        <span className="pr0-eyebrow">{t("keyboard.heading")}</span>
        <span className="pr0-mono">{t("keyboard.hints")}</span>
      </div>

      {onClipboardFailureChange === undefined ? null : (
        <div className="pr0-footnote pr0-tools">
          <span className="pr0-eyebrow">{t("debug.heading")}</span>
          <label>
            <input
              checked={clipboardFails}
              onChange={(event) =>
                onClipboardFailureChange(event.target.checked)
              }
              type="checkbox"
            />
            {t("debug.failClipboard")}
          </label>
          <span>{t("debug.failClipboardHint")}</span>
        </div>
      )}
    </div>
  );
};

export const PrototypeShell = ({
  tolgeeOptions,
  ...props
}: PrototypeShellProps) => (
  <PrototypeI18nProvider options={tolgeeOptions}>
    <ShellInner {...props} />
  </PrototypeI18nProvider>
);
