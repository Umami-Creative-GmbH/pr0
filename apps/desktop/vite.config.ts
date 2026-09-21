import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (command === "build") {
    const baseUrl = env.VITE_API_BASE_URL;
    if (!baseUrl || new URL(baseUrl).protocol !== "https:") {
      throw new Error(
        "Desktop builds require an HTTPS VITE_API_BASE_URL. Set it in apps/desktop/.env.local or the build environment."
      );
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("index.html", import.meta.url)),
          launcher: fileURLToPath(new URL("launcher.html", import.meta.url)),
        },
      },
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: { ignored: ["**/src-tauri/**"] },
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
  };
});
