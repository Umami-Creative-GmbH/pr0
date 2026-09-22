import {
  residentActionSchema,
  residentStatusSchema,
  startupActionSchema,
  startupStatusSchema,
} from "@pr0/api-contract/desktop-resident";
import type {
  ResidentAction,
  StartupAction,
} from "@pr0/api-contract/desktop-resident";
import { invoke } from "@tauri-apps/api/core";

export const residentClient = {
  startupStatus: async () =>
    startupStatusSchema.parse(await invoke("startup_status")),
  startupAction: async (action: StartupAction) =>
    startupStatusSchema.parse(
      await invoke("startup_action", {
        action: startupActionSchema.parse(action),
      })
    ),
  status: async () =>
    residentStatusSchema.parse(await invoke("resident_status")),
  action: async (action: ResidentAction) => {
    await invoke("resident_action", {
      action: residentActionSchema.parse(action),
    });
  },
  hide: async () => {
    await invoke("resident_hide");
  },
  finishQuit: async () => {
    await invoke("resident_finish_quit");
  },
};
