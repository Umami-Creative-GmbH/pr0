# English and German localization — issue #91

Validated on September 22, 2026, on Windows with Edge and WebView2.

## Behavior

The web application, desktop library, and native launcher use the shared English and German catalogs in `packages/ui/src/locales`. The German sign-in headline and lede reproduce the [approved sign-in reference](../evidence/design-75/claude-design-anmelden-light.png). The approved English sign-in copy is retained.

Language defaults to the browser/WebView language, with English for unsupported languages. The language control offers system, English, and German. Like theme, the override is stored locally (`pr0.language`), survives reloads, and propagates between the desktop and launcher through storage events. It is not account data. The document language, native tray menu, and launcher window title follow it.

Labels and notices update without replaying requests or replacing open drafts. The message adapter translates retained application notices and fixed REST/schema messages; interpolated user titles, names, and content remain unchanged.

## Verification

- `bun run typecheck`: all six workspace tasks passed.
- `bun run test`: all nine workspace tasks passed.
- `bun x --bun ultracite fix`: passed.
- Production web build through `test:design`, desktop Vite build, and native WebView test build passed.
- Native Rust library suite: all 160 tests passed.
- `localization-browser.test.ts`: two journeys passed, covering the exact German hero, a localized retry notice that changes language without another request, persisted override, return to system, and unsupported-language fallback.
- `localization-desktop.test.ts`: passed against the real native WebView. Both main and launcher follow German and share the override; the open draft survives the switch unchanged; the override survives reload.
- Existing English `design-browser.test.ts`, `variables-browser.test.ts`, and `design-desktop.test.ts`: all thirteen journeys passed. Browser/native fixtures explicitly select English unless a localization journey overrides it.

The extra standalone `sync-presentation.test.tsx` server-render snapshot suite has ten pre-existing failures: its assertions expect status summaries in the rendered tree, while those summaries now render through the app-bar portal. Running the same suite with the original desktop status component from commit `704eaca` reproduced all ten failures. The required workspace suite passes.

## Review

Parallel standards and specification reviews found a raw resource-key fallback, retained lifecycle/synchronization labels, and a shortcut retry that could restore an English tray tooltip. These were corrected. Typechecking and the native German/override journey passed again after the fixes. Both reviewers confirmed no remaining blockers.

One advisory remains: the legacy notice adapter cannot distinguish different English messages with identical German translations. After switching languages, an already displayed notice can use an equivalent English phrase (for example, “Text copied.” instead of “Copied text.”). New labels translate directly by key; user content is not passed through this adapter.
