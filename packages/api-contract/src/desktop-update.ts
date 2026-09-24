import { z } from "zod";

// Native-only. Executable trust is never negotiated with the library REST API.
export const updateStatusSchema = z.strictObject({
  phase: z.enum([
    "unconfigured",
    "idle",
    "checking",
    "current",
    "available",
    "downloading",
    "ready",
    "installing",
  ]),
  version: z.string().min(1).max(128).nullable(),
  error: z
    .enum([
      "check_failed",
      "download_failed",
      "verification_failed",
      "install_failed",
      "storage_unavailable",
    ])
    .nullable(),
});
export type UpdateStatus = z.infer<typeof updateStatusSchema>;
