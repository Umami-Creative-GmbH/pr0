import { LocaleDocument } from "@pr0/ui/components/locale-document";
import { PresentationActive } from "@pr0/ui/hooks/use-presentation-time";
import { useLocale, useTranslations } from "@pr0/ui/hooks/use-translations";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  subscribeSurfaceVisibility,
  surfaceVisible,
} from "./surface-visibility";

export const NativePresentation = ({ children }: { children: ReactNode }) => {
  const locale = useLocale();
  const t = useTranslations();
  const [languageError, setLanguageError] = useState(false);
  useEffect(() => {
    if (window.location.pathname.endsWith("launcher.html")) {
      return;
    }
    let disposed = false;
    const update = async () => {
      try {
        await invoke("desktop_language", { language: locale });
        if (!disposed) {
          setLanguageError(false);
        }
      } catch {
        if (!disposed) {
          setLanguageError(true);
        }
      }
    };
    void update();
    return () => {
      disposed = true;
    };
  }, [locale]);
  const active = useSyncExternalStore(
    subscribeSurfaceVisibility,
    surfaceVisible
  );
  return (
    <PresentationActive value={active}>
      <LocaleDocument />
      {languageError ? <output>{t("nativeLanguageFailure")}</output> : null}
      {children}
    </PresentationActive>
  );
};
