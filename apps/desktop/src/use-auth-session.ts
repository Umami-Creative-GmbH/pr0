import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const statusSchema = z.strictObject({
  state: z.enum([
    "signed_out",
    "awaiting_approval",
    "signed_in",
    "authentication_required",
    "cleanup_required",
  ]),
  generation: z.number().int().nonnegative(),
  origin: z.string().nullable(),
  email: z.string().nullable(),
  accountId: z.string().nullable(),
  instanceId: z.string().nullable(),
  userCode: z.string().nullable(),
  message: z.string(),
  pollAfterMs: z.number().nonnegative(),
});
export type Status = z.infer<typeof statusSchema>;
export type Command =
  | "auth_status"
  | "auth_begin"
  | "auth_poll"
  | "auth_cancel"
  | "auth_open_browser"
  | "auth_refresh"
  | "auth_sign_out";
const command = async (name: Command, origin?: string) =>
  statusSchema.parse(await invoke(name, origin ? { origin } : undefined));
const errors = {
  pending_work:
    "Changes are waiting to sync. Sign-out is unavailable; your local work is retained.",
  invalid_instance:
    "Enter a trusted HTTPS server address without a path, username, or query.",
  incompatible_instance:
    "This server is incompatible. Check the address or update pr0.",
  instance_identity_changed:
    "This server's identity changed. Retained local files are preserved. Contact your server operator.",
  same_account_required:
    "Sign in to the same account on the same server. Retained local files cannot move to another account.",
  credential_unavailable:
    "Windows could not store or read the credential. Persistent sign-in is incomplete. Retry sign-in.",
  local_data_requires_review:
    "Local data needs review before sign-out. Use a version of pr0 that supports its pending-work choices.",
  authentication_required:
    "Sign in again to resume this session. Local files are preserved.",
  approval_failed:
    "Approval was denied, expired, or already used. Start a new sign-in.",
  redirect_rejected:
    "The server redirected the request. Use its canonical HTTPS address.",
};
const errorCodeSchema = z.keyof(
  z.object({
    pending_work: z.string(),
    invalid_instance: z.string(),
    incompatible_instance: z.string(),
    instance_identity_changed: z.string(),
    same_account_required: z.string(),
    credential_unavailable: z.string(),
    local_data_requires_review: z.string(),
    authentication_required: z.string(),
    approval_failed: z.string(),
    redirect_rejected: z.string(),
  })
);
export const useAuthSession = () => {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const requestGeneration = useRef(0);
  const notice = useRef<HTMLParagraphElement>(null);
  const apply = useCallback((next: Status) => {
    setStatus((current) =>
      current && current.generation > next.generation ? current : next
    );
  }, []);
  const run = useCallback(
    async (name: Command, selected?: string) => {
      requestGeneration.current += 1;
      const generation = requestGeneration.current;
      setBusy(true);
      setErrorText("");
      try {
        const next = await command(name, selected);
        if (generation === requestGeneration.current) {
          apply(next);
        }
      } catch (error) {
        if (generation === requestGeneration.current) {
          const code = errorCodeSchema.safeParse(error);
          setErrorText(
            code.success
              ? errors[code.data]
              : "The operation did not complete. Retry; retained local files are preserved."
          );
          try {
            const next = await command("auth_status");
            if (generation === requestGeneration.current) {
              apply(next);
            }
          } catch {
            /* Preserve the error if native storage cannot be opened. */
          }
        }
      }
      if (generation === requestGeneration.current) {
        setBusy(false);
        notice.current?.focus();
      }
    },
    [apply]
  );
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await command("auth_status");
        if (active) {
          apply(next);
        }
      } catch {
        if (active) {
          setErrorText(
            "The saved sign-in could not be loaded. Retry; local files are preserved."
          );
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [apply]);
  useEffect(() => {
    if (status?.state !== "awaiting_approval") {
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const next = await command("auth_poll");
        if (active) {
          apply(next);
        }
      } catch {
        if (active) {
          await run("auth_status");
          setErrorText(
            "Approval did not complete. Start a new sign-in. An undelivered session can be revoked in browser settings."
          );
        }
      }
    };
    const timer = setTimeout(
      () => {
        void poll();
      },
      Math.max(1000, status.pollAfterMs)
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status, apply, run]);
  return { status, busy, error: errorText, notice, run };
};
