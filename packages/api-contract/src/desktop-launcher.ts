import { z } from "zod";

import { desktopCopySchema } from "./desktop-copy";
import { desktopSearchSchema } from "./desktop-search";

// Native-only commands. No new REST operation or renderer-owned library mirror.
export const launcherAccountSchema = desktopCopySchema.omit({ promptId: true });
export const launcherStatusSchema = z.strictObject({
  opening: z.number().int().nonnegative(),
  visible: z.boolean(),
  focused: z.boolean(),
  shortcut: z
    .enum(["Ctrl+Shift+P", "Alt+Space", "Ctrl+Alt+P", "Ctrl+Shift+Space"])
    .nullable(),
  account: launcherAccountSchema.nullable(),
  complete: z.boolean(),
  error: z.literal("library_unavailable").nullable(),
});
export const launcherSearchSchema = desktopSearchSchema.refine(
  (request) =>
    request.view === "all" &&
    !request.viewCollectionId &&
    (request.sort === "relevance" || request.sort === "recently-used"),
  "The launcher searches active prompts in relevance or recent-use order."
);
export type LauncherStatus = z.infer<typeof launcherStatusSchema>;
