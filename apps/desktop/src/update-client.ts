import { updateStatusSchema } from "@pr0/api-contract/desktop-update";
import { invoke } from "@tauri-apps/api/core";

export const updateClient = {
  status: async () => updateStatusSchema.parse(await invoke("update_status")),
  check: async () => {
    await invoke("update_check");
  },
  download: async () => {
    await invoke("update_download");
  },
  install: async () => {
    await invoke("update_request_install");
  },
};
