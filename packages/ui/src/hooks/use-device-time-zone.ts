"use client";

import { useSyncExternalStore } from "react";

const subscribe = (listener: () => void) => {
  window.addEventListener("focus", listener);
  return () => window.removeEventListener("focus", listener);
};
const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverTimeZone = () => "UTC";

/** Hydrate in UTC, then display dates in the device's time zone. */
export const useDeviceTimeZone = () =>
  useSyncExternalStore(subscribe, deviceTimeZone, serverTimeZone);
