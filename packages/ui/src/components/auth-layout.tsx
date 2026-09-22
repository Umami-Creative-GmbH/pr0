import type { ReactNode } from "react";

import { Wordmark } from "./wayfinder-shell";

/**
 * Sign-in composition from the accepted "pr0 Anmelden" design: brand panel
 * beside the form. It only arranges content; authentication stays with callers.
 */
export const AuthLayout = ({
  keys,
  children,
}: {
  /** Real key hints for this surface. */
  keys: string;
  children: ReactNode;
}) => (
  <div className="wf-auth">
    <div className="wf-auth-hero">
      <Wordmark size="lg" />
      <div className="flex flex-col gap-5">
        <span className="wf-eyebrow-accent">Prompt library</span>
        <h1>The place where your best prompts live.</h1>
        <p>
          Find, copy, keep working. On the desktop and in the browser, one
          library per account.
        </p>
        <p className="wf-mono">{keys}</p>
      </div>
      <div className="wf-rule" />
    </div>
    <div className="wf-auth-form">{children}</div>
  </div>
);
