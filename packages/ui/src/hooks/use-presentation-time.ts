"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Platforms may suspend presentation clocks without suspending data sync.
export const PresentationActive = createContext(true);

export const usePresentationTime = () => {
  const active = useContext(PresentationActive);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const update = () => setNow(Date.now());
    const immediate = setTimeout(update, 0);
    const timer = setInterval(update, 60_000);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [active]);
  return now;
};
