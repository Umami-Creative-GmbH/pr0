# Web prompt variables — issue #52

Implemented against `docs/specs/variable-substitution-copy.md` and the parent issue's approved shared-conformance, REST and browser boundaries.

The shared contract exports the production parser and bounded substitution function plus portable JSON tokenization and validation vectors. Invalid UTF-16 vectors use code-unit arrays so the fixture file itself remains valid Unicode. The web form uses the existing scoped prompt reads and shared clipboard guard; usage still sends only the existing `prompt.use` metadata. No value persistence, new wire mutation, database schema or native permission is introduced.

## Verification

- `bun test packages/api-contract/src/variables.test.ts`: 45 tests passed, including the canonical malformed-candidate, escape, decimal, scalar, malicious-name and inclusive UTF-8 bound cases.
- `bun run typecheck`: all six workspace checks passed.
- `bun run test`: the full configured workspace suite passed. Browser acceptance is a separate served-production-build command below.
- `bun run --cwd apps/web test:variables`: real PostgreSQL, Next.js/Bun, headless Chrome and WebKit. Covers exact output and unchanged saved templates, metadata-only usage payloads, validation errors, failed clipboard writes, usage-only retry, explicit restart and type revalidation, removed/new names, observed deletion, escaping without fields, archive copying, frozen controls, cancellation, page exit and account transitions with retained editor drafts.
- Keyboard traversal reaches all 100 fields at 200% zoom. Escape clears values and returns focus to the opener. See [the captured form](../evidence/issue-52-variables-zoom.png).
- [Copy timing](../evidence/issue-52-copy-timing.json) records final form submission through actual clipboard confirmation for the inclusive 262,144-byte result, including validation, substitution and the scoped REST eligibility check. The acceptance assertion is below 150 ms. This local sample is not a production percentile or installed-desktop performance claim.
- Changed-file Ultracite checks and Git whitespace checks passed. The complete repository check still reports existing formatting issues in seven untouched files and lint findings in `docs/research/search-parity/*.mjs`.
- The standalone React Doctor 0.9.14 CLI crashes under Bun 1.4.2 on Windows at `child.channel?.unref`. The repository's integrated React Doctor lint rules run successfully for these changes; no standalone health score is claimed.

Eighteen browser cases passed in the final full run. The remaining usage-retry case passed in a focused rerun after waiting for the restored account's eligible prompt view (`--test-name-pattern 'late usage-only'`). All nineteen scenarios have been verified against the final production implementation.

Standards and Spec reviews identified an account-generation cleanup race when an unsaved editor draft retains the library component. Shared cleanup and generation-guarded copy/usage-retry completion fix it; both review axes have no unresolved findings. Browser regressions cover switching away during a pending write or usage retry, returning to the original account, and copying again without losing the editor draft.

The browser fixture allows 15 seconds for ordinary UI observations, covering existing five-second admission retry and ten-second result-refresh behavior. The clipboard performance assertion remains a separate 150 ms check.

Environment: Windows x64, Bun 1.4.2, Next.js 16.3.5, PostgreSQL 17 fixture, Chrome 154; browser identity is captured alongside the timing. Native desktop conformance and installed Windows journeys belong to the separate desktop slice.
