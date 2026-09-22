import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import next from "ultracite/oxlint/next";
import nextJsPlugins from "ultracite/oxlint/next/js-plugins";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import tanstackJsPlugins from "ultracite/oxlint/tanstack/js-plugins";

const jsPlugins = selectJsPlugins(["react-doctor", "github"]);

export default defineConfig({
  extends: [
    core,
    react,
    next,
    tanstack,
    nextJsPlugins,
    tanstackJsPlugins,
    shadcn,
    antiSlop,
    jsPlugins,
  ],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/.next/**",
    "**/.turbo/**",
    "**/dist/**",
    "**/target/**",
    "**/src-tauri/gen/**",
    "**/public/swagger-ui/**",
    ".agents/**",
    ".claude/**",
  ],
  jsPlugins: [...jsPlugins.jsPlugins, ...shadcn.jsPlugins],
  settings: jsPluginSettings,
  overrides: [
    {
      // Preserve shadcn's generated component/variant API and theme calculations.
      files: ["packages/ui/src/components/button.tsx"],
      rules: {
        "react-doctor/only-export-components": "off",
        "shadcn/no-arbitrary-values": "off",
      },
    },
  ],
});
