import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    "**/node_modules/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/dist/**",
    "**/target/**",
    "**/src-tauri/gen/**",
    "**/public/swagger-ui/**",
    ".agents/**",
    ".claude/**",
    "bun.lock",
  ],
});
