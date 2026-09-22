import type { ReactNode } from "react";

import { useTranslations } from "../hooks/use-translations";
import { Wordmark } from "./wayfinder-shell";

/**
 * Sign-in composition from the accepted "pr0 Anmelden" design: brand panel
 * beside the form. It only arranges content; authentication stays with callers.
 */
export const AuthLayout = ({
  keys,
  children,
}: {
  /** Real key hints for this surface. */
  keys: string;
  children: ReactNode;
}) => {
  const t = useTranslations();
  return (
    <div className="wf-auth">
      <div className="wf-auth-hero">
        <Wordmark size="lg" />
        <div className="flex flex-col gap-5">
          <span className="wf-eyebrow-accent">{t("promptLibrary")}</span>
          <h1>{t("thePlaceWhereYourBestPromptsLive")}</h1>
          <p>{t("findCopyKeepWorkingOnTheDesktopAndInThe")}</p>
          <p className="wf-mono">{keys}</p>
        </div>
        <div className="wf-rule" />
      </div>
      <div className="wf-auth-form">{children}</div>
    </div>
  );
};
