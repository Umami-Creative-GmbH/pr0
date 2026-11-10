"use client";
import { useState } from "react";
import type { ReactNode } from "react";

import { pickerSearchThreshold } from "./picker-search";

/** Keep large inline pickers out of the library's render and focus paths until opened. */
export const PickerOptions = ({
  compact,
  count,
  label,
  children,
}: {
  compact: boolean;
  count: number;
  label: string;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  if (!compact || count <= pickerSearchThreshold) {
    return children;
  }
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="wf-btn cursor-pointer">
        {label} · {count}
      </summary>
      {open ? <div className="mt-2 space-y-2">{children}</div> : null}
    </details>
  );
};
