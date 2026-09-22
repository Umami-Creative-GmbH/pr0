import type { ReactNode } from "react";

export const pickerSearchThreshold = 8;
/** Shows a picker's search field once its list is long enough to need one. */
export const PickerSearch = ({
  count,
  children,
}: {
  /** Entries available to search; short lists need no search field. */
  count: number;
  children: ReactNode;
}) => (count > pickerSearchThreshold ? children : null);
