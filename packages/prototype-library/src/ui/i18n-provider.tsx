/**
 * PROTOTYPE (issue #9) — i18n boundary.
 *
 * Keeps Tolgee an implementation detail of this package so the apps do not
 * depend on the SDK directly. Swapping the static catalogues for the
 * self-hosted Tolgee server happens behind this component.
 */

"use client";

import { TolgeeProvider } from "@tolgee/react";
import type { ReactNode } from "react";
import { useMemo } from "react";

import type { TolgeeOptions } from "../i18n/tolgee";
import { createTolgee } from "../i18n/tolgee";

export interface PrototypeI18nProviderProps {
  children: ReactNode;
  options?: TolgeeOptions;
}

export const PrototypeI18nProvider = ({
  children,
  options,
}: PrototypeI18nProviderProps) => {
  const tolgee = useMemo(() => createTolgee(options), [options]);

  return (
    <TolgeeProvider fallback={null} tolgee={tolgee}>
      {children}
    </TolgeeProvider>
  );
};
