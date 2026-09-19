# pr0 library + launcher prototype

**Throwaway.** Built to settle [issue #9](https://github.com/Umami-Creative-GmbH/pr0/issues/9). Not production code, and not a starting point for one.

### Removing it

Everything below reverts to `beec6f2`:

- delete `packages/prototype-library/`, `apps/web/src/app/prototype/`, `apps/desktop/launcher.html`, `apps/desktop/src/launcher.tsx` and `apps/desktop/src/prototype-bridge.ts`;
- drop `@pr0/prototype-library` from `apps/web/package.json` and `apps/desktop/package.json`;
- **restore `apps/desktop/src/app.tsx`** — the prototype replaced its `useHealth` / `StarterScreen` body rather than sitting beside it;
- revert `apps/desktop/src-tauri/` — `tauri.conf.json` (the `launcher` window and the `devCsp` font sources), `capabilities/default.json` (back to `"permissions": []`), `Cargo.toml` and `src/lib.rs`;
- revert the multi-page `build.rollupOptions.input` in `apps/desktop/vite.config.ts`;
- delete the four prototype blocks in `oxlint.config.ts`.

The shipping `csp` was deliberately left untouched: only `devCsp` allows the Google Fonts origins the prototype stylesheet imports, so a production build is unaffected.

### A deliberate departure from the prototype skill

`.claude/skills/prototype/SKILL.md` says "no tests". This one has 69, over the domain and store only. The whole point of the prototype is that it exercises the semantics already settled in #7 and #4 rather than the design's simplified versions — and that claim is only worth anything if it is checkable. The UI, where the skill's reasoning does apply, has none.

It exists to be **driven by a human**, not read. The agent must not record the outcome on its behalf.

## The question

> Does a concrete interaction prototype make finding and copying a prompt faster while keeping editing and organization easy to reach?

## Run it

Web — library, in-page launcher, both surfaces and the sign-in screen:

```bash
bun run dev:web
```

Then open <http://localhost:3000/prototype/library>.

Desktop — the same library plus a **real** Windows global shortcut and a separate native launcher window:

```bash
bun run dev:desktop
```

**Where to look for the shortcut:** not the OS title bar (that just says `pr0`). It is the strip _inside_ the app, at the top of the window, immediately left of `SYNCHRONISIERT`. It always says something — registering, the binding it got, that none was available, or that the lookup failed.

The terminal running `dev:desktop` is the second source of truth. Every attempt is logged, so a collision is visible rather than inferred:

```text
[pr0] global shortcut unavailable: Ctrl+Shift+P (...)
[pr0] global shortcut registered: Alt+Space
[pr0] global shortcut pressed
```

If you press the binding and no `global shortcut pressed` line appears, the keystroke never reached the app — something else owns it.

## What is real and what is faked

| Real | Faked |
| --- | --- |
| Retrieval semantics from issue #7 (tiers, AND filters, sorts, recency) | All data: an in-memory seed, reset on reload |
| Lifecycle rules from issue #4 (archive, duplicate, dates, validation) | Sign-in — the screen is a picture, any button enters |
| Clipboard writes, success and failure, on both surfaces | Sync — the "Synchronisiert" badge is decoration |
| Windows global shortcut, collision fallback, launcher window | No API, no persistence, no accounts |
| German and English UI through Tolgee |  |

## Driving the hard cases

- **Clipboard failure.** The checkbox under the stage (_Zwischenablage scheitern lassen_) forces every copy to fail. Use it to see the launcher stay open with its query and selection, and to retry.
- **Empty states.** Search `zzz` for the no-match state; open _Zuletzt genutzt_ and _Archiv_ for their own copy. They are deliberately different.
- **Selection under changing results.** Select a row, then type in the search box. Selection follows the prompt's identity while it still qualifies, then falls to the first result.
- **Archive isolation.** `Alter Newsletter-Aufbau` is an archived favourite. It appears only in _Archiv_ — never in the launcher, favourites or recents.
- **Variables.** Most seeded prompts contain `{{platzhalter}}`. `Rechtschreibung und Grammatik prüfen` and `Daily-Standup-Fragen` do not, so they exercise the plain copy path.
- **Variables in the launcher.** Copying a prompt with variables asks for the values _inside_ the launcher, and only then writes and closes — settled on issue #9. Escape steps back to the results without losing the query; a second Escape closes the launcher.

## Known gaps, on purpose

- `launcher.count` caps results at 7, carried from the design. A match ranked 8th is unreachable without narrowing the query.
- Variable substitution has been pulled **into** MVP scope (issue #9 session). Issue #1's "Out of scope" list still says otherwise and needs updating.
- Windows may refuse to give the launcher foreground focus when another app is active. See the note in `apps/desktop/src-tauri/src/lib.rs`.
- Collection and tag management (rename, merge, delete) is not built. Only assignment through the editor is.
- **Save/sync/conflict states are not built.** The "Synchronisiert" badge is decoration. Issue #9 asks for visible conflict states; that part of the ticket is not covered here and still needs a decision.
- No tray, autostart or background-process behaviour, so #9's questions about whether the app must already be running are also still open.

## Layout

```
src/domain/    Retrieval, lifecycle, copy and variable rules — all unit tested
src/store/     View, sort-memory and selection reducer — unit tested
src/i18n/      Tolgee setup + de/en catalogues (flat ICU keys, import-ready)
src/ui/        Components; styling lives in src/ui/prototype.css
```

The domain and store are covered by `bun test`; the UI is not, by design.

## i18n

Tolgee runs against the local catalogues, so no server is needed. Pointing it at the self-hosted instance is a config change — pass `apiUrl` and `apiKey` through `tolgeeOptions`; the keys are unchanged. `de.json` and `en.json` are flat ICU and import into a Tolgee project as-is.
