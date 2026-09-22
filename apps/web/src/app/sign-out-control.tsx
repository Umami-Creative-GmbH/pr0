"use client";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useState } from "react";

export const SignOutControl = ({
  dirty,
  busy,
  onSignOut,
}: {
  dirty: boolean;
  busy: boolean;
  onSignOut: () => void;
}) => {
  const t = useTranslations();

  const [confirm, setConfirm] = useState(false);
  const buttonClass = "wf-btn";
  return (
    <div>
      <button
        className="wf-menu-item"
        disabled={busy}
        onClick={() => {
          if (dirty) {
            setConfirm(true);
          } else {
            onSignOut();
          }
        }}
        type="button"
      >
        {t("signOut")}
      </button>
      {confirm ? (
        <section
          aria-label={t("confirmSignOut")}
          className="wf-notice mt-2"
          data-tone="attention"
        >
          <p>{t("signOutAndDiscardThisUnsavedOpenTabDraftIf")}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              className={buttonClass}
              disabled={busy}
              onClick={onSignOut}
              type="button"
            >
              {t("discardDraftAndSignOut")}
            </button>
            <button
              className={buttonClass}
              onClick={() => setConfirm(false)}
              type="button"
            >
              {t("keepEditing")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
};
