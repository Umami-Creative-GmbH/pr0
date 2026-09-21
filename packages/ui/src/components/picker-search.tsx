import type { ReactNode } from "react";

export const PickerSearch = ({
  compact,
  label,
  children,
}: {
  compact: boolean;
  label: string;
  children: ReactNode;
}) =>
  compact ? (
    <details className="wf-picker-search">
      <summary>Search {label.toLowerCase()}</summary>
      {children}
    </details>
  ) : (
    children
  );
