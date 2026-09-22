import { Search } from "lucide-react";
import type { ComponentProps } from "react";

/** The library search field: icon, borderless search input and a key hint. */
export const SearchBox = ({
  hint,
  invalid,
  ...input
}: Omit<ComponentProps<"input">, "type" | "className"> & {
  hint?: string;
  invalid?: boolean;
}) => (
  <div className="wf-searchbox" data-invalid={invalid}>
    <Search aria-hidden="true" size={16} />
    <input {...input} type="search" aria-invalid={invalid} />
    {hint ? (
      <kbd className="wf-kbd" aria-hidden="true">
        {hint}
      </kbd>
    ) : null}
  </div>
);
