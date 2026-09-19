# pr0 library + launcher prototype

**Throwaway.** Built to settle [issue #9](https://github.com/Umami-Creative-GmbH/pr0/issues/9).
Not production code, and not a starting point for one: delete this package,
the `apps/web/src/app/prototype/` route and the prototype blocks in
`oxlint.config.ts` once the decision is recorded.

It exists to be **driven by a human**, not read. The agent must not record the
outcome on its behalf.

## The question

> Does a concrete interaction prototype make finding and copying a prompt
> faster while keeping editing and organization easy to reach?

## Run it

Web — library, in-page launcher, both surfaces and the sign-in screen:

```bash
bun run dev:web
```

Then open <http://localhost:3000/prototype/library>.

Desktop — the same library plus a **real** Windows global shortcut and a
separate native launcher window:

```bash
bun run dev:desktop
```

The desktop window's header shows which global shortcut actually registered.

## What is real and what is faked

| Real | Faked |
| --- | --- |
| Retrieval semantics from issue #7 (tiers, AND filters, sorts, recency) | All data: an in-memory seed, reset on reload |
| Lifecycle rules from issue #4 (archive, duplicate, dates, validation) | Sign-in — the screen is a picture, any button enters |
| Clipboard writes, success and failure, on both surfaces | Sync — the "Synchronisiert" badge is decoration |
| Windows global shortcut, collision fallback, launcher window | No API, no persistence, no accounts |
| German and English UI through Tolgee | |

## Driving the hard cases

- **Clipboard failure.** The checkbox under the stage (*Zwischenablage
  scheitern lassen*) forces every copy to fail. Use it to see the launcher stay
  open with its query and selection, and to retry.
- **Empty states.** Search `zzz` for the no-match state; open *Zuletzt genutzt*
  and *Archiv* for their own copy. They are deliberately different.
- **Selection under changing results.** Select a row, then type in the search
  box. Selection follows the prompt's identity while it still qualifies, then
  falls to the first result.
- **Archive isolation.** `Alter Newsletter-Aufbau` is an archived favourite. It
  appears only in *Archiv* — never in the launcher, favourites or recents.
- **Variables.** Most seeded prompts contain `{{platzhalter}}`.
  `Rechtschreibung und Grammatik prüfen` and `Daily-Standup-Fragen` do not, so
  they exercise the plain copy path.

## Known gaps, on purpose

- The launcher closes when a prompt **with** variables hands off to the value
  dialog, before any clipboard write. That follows the design but bends issue
  #7's "closes only after a successful clipboard write". **Open question.**
- Variable substitution is out of MVP scope per issue #1. It is prototyped
  because the design explores it; whether to pull it into scope is a decision
  for the human.
- Windows may refuse to give the launcher foreground focus when another app is
  active. See the note in `apps/desktop/src-tauri/src/lib.rs`.
- Collection and tag management (rename, merge, delete) is not built. Only
  assignment through the editor is.

## Layout

```
src/domain/    Retrieval, lifecycle, copy and variable rules — all unit tested
src/store/     View, sort-memory and selection reducer — unit tested
src/i18n/      Tolgee setup + de/en catalogues (flat ICU keys, import-ready)
src/ui/        Components; styling lives in src/ui/prototype.css
```

The domain and store are covered by `bun test`; the UI is not, by design.

## i18n

Tolgee runs against the local catalogues, so no server is needed. Pointing it
at the self-hosted instance is a config change — pass `apiUrl` and `apiKey`
through `tolgeeOptions`; the keys are unchanged. `de.json` and `en.json` are
flat ICU and import into a Tolgee project as-is.
