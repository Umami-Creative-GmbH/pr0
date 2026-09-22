"use client";
import { useTranslations } from "@pr0/ui/hooks/use-translations";

export const OrganizationTabs = ({
  value,
  disabled,
  onChange,
}: {
  value: "collections" | "tags";
  disabled: boolean;
  onChange: (tab: "collections" | "tags") => void;
}) => {
  const t = useTranslations();
  return (
    <div
      role="tablist"
      aria-label={t("organization")}
      className="my-3 flex gap-2"
    >
      {(["collections", "tags"] as const).map((tab) => (
        <button
          key={tab}
          id={`${tab}-tab`}
          role="tab"
          aria-selected={value === tab}
          aria-controls="organization-panel"
          tabIndex={value === tab ? 0 : -1}
          disabled={disabled}
          className="wf-btn"
          type="button"
          onClick={() => onChange(tab)}
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              return;
            }
            event.preventDefault();
            let next: "collections" | "tags" =
              tab === "tags" ? "collections" : "tags";
            if (event.key === "Home") {
              next = "collections";
            }
            if (event.key === "End") {
              next = "tags";
            }
            onChange(next);
            document.querySelector<HTMLButtonElement>(`#${next}-tab`)?.focus();
          }}
        >
          {tab === "tags" ? t("tags") : t("collections")}
        </button>
      ))}
    </div>
  );
};
