import { PresentationActive } from "@pr0/ui/hooks/use-presentation-time";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import {
  subscribeSurfaceVisibility,
  surfaceVisible,
} from "./surface-visibility";

export const NativePresentation = ({ children }: { children: ReactNode }) => {
  const active = useSyncExternalStore(
    subscribeSurfaceVisibility,
    surfaceVisible
  );
  return <PresentationActive value={active}>{children}</PresentationActive>;
};
