import {
  residentActionSchema,
  residentStatusSchema,
} from "@pr0/api-contract/desktop-resident";
import type { ResidentAction } from "@pr0/api-contract/desktop-resident";
import { invoke } from "@tauri-apps/api/core";

export const residentClient = {
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
