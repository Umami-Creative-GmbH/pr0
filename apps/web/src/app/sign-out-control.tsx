"use client";

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
        Sign out
      </button>
      {confirm ? (
        <section
          aria-label="Confirm sign out"
          className="wf-notice mt-2"
          data-tone="attention"
        >
          <p>
            Sign out and discard this unsaved open-tab draft? If saving is
            uncertain, retry first to confirm whether the server saved it.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              className={buttonClass}
              disabled={busy}
              onClick={onSignOut}
              type="button"
            >
              Discard draft and sign out
            </button>
            <button
              className={buttonClass}
              onClick={() => setConfirm(false)}
              type="button"
            >
              Keep editing
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
};
