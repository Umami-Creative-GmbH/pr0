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
    {
      // PROTOTYPE (issue #9): the quick launcher is an ARIA combobox/listbox.
      // There is no native HTML tag for a command palette, so the roles are
      // the correct markup here rather than `select`/`option`.
      files: ["packages/prototype-library/src/ui/launcher-panel.tsx"],
      rules: {
        "jsx-a11y/prefer-tag-over-role": "off",
        "jsx-a11y/no-noninteractive-element-to-interactive-role": "off",
      },
    },
    {
      // PROTOTYPE (issue #9): dismissing a native <dialog> by clicking its
      // backdrop has no keyboard analogue to add - Escape already closes it,
      // handled by the dialog's own cancel event.
      files: ["packages/prototype-library/src/ui/overlay.tsx"],
      rules: {
        "jsx-a11y/click-events-have-key-events": "off",
        "jsx-a11y/no-noninteractive-element-interactions": "off",
      },
    },
    {
      // PROTOTYPE (issue #9): throwaway, and deliberately styled by its own
      // self-contained stylesheet rather than Tailwind, so the whole thing can
      // be deleted in one directory. Remove this override with the prototype.
      files: [
        "packages/prototype-library/**",
        "apps/desktop/src/launcher.tsx",
        "apps/web/src/app/prototype/**",
      ],
      rules: {
        "shadcn/no-unknown-classes": "off",
        "shadcn/no-inline-styles": "off",
        "shadcn/no-arbitrary-values": "off",
        // Array#toSorted needs lib ES2023, which the shared tsconfig does not
        // enable. The sorts here run on arrays built locally in the same
        // expression, so nothing a caller holds is mutated.
        "unicorn/no-array-sort": "off",
      },
    },
  ],
});
