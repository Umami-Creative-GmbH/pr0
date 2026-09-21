import type { ReactNode } from "react";

export const pickerSearchThreshold = 8;
export const PickerSearch = ({
  compact,
  label,
  count,
  children,
}: {
  compact: boolean;
  label: string;
  /** Entries available to search; short lists need no search field. */
  count: number;
  children: ReactNode;
}) => {
  if (count <= pickerSearchThreshold) {
    return null;
  }
  return compact ? (
    <details className="wf-hint">
      <summary>Search {label.toLowerCase()}</summary>
      {children}
    </details>
  ) : (
    children
  );
};
