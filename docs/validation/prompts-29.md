# Prompt creation and reopening — issue #29

The production web entry now creates and reads private prompts using the shared validated REST client. The throwaway prototype remains separate.

## Reproduce

Use Bun 1.4.2+, Docker and installed Chrome on Windows:

```powershell
bun run --cwd apps/web test:prompts
bun run typecheck
bun run test
```

The acceptance runner builds Next.js, starts its production server and disposable PostgreSQL/SMTP containers on ports 30426, 55426, 18426 and 11426, applies all migrations, exercises REST and Chrome, restarts the server and checks retained text, dates and the original operation receipt. Cleanup removes only its `pr0-prompts-29` containers. OAuth uses the existing test-only provider transport; authorization and PostgreSQL persistence are real.

Tests assert through public REST or browser UI. Capacity setup seeds complete existing libraries in the isolated test database so the 10,000-prompt and 100 MiB races can be exercised without bypassing production admission limits. Assertions never query internal tables. No production fixture or quota override is introduced.

## Coverage

- Exact whitespace preservation, required fields, trimmed title/description, duplicate titles and server dates.
- Shared malformed Unicode/NUL and maximum-size Unicode vectors; no truncation.
- Authenticated ownership, foreign detail denial, CSRF origin checks and identity/epoch checks.
- Atomic quota races, one effect under simultaneous repeated delivery, immutable operation identity and mixed independent outcomes.
- Bounded summary pages, numeric revision ordering, signed account/revision-bound cursors and complete browser pagination.
- Saving keeps the editor open. A lost response retains the draft and original operation, even when a retry is throttled. Clipboard failure retains text; successful recovery copying records no prompt-use operation.
- Invalid input, 90% field warnings, sign-out confirmation and retained drafts during list refresh. Browser reload reopens acknowledged content.
- Switching accounts in another tab retains the original open draft. Scope-validated read responses cannot populate the wrong account view; Retry succeeds only after returning to the original account.
- Server restart preserves accepted prompt text and the receipt without creating another prompt.

Screenshots: [saved prompt](../evidence/issue-29-saved-prompt.png) and [retained invalid draft](../evidence/issue-29-draft-validation.png).

## Implementation scope

Migration 007 adds the instance recovery epoch, serialization/quota counters, owned prompts, compact operation receipts and change records. `POST /api/v1/sync/mutations` currently accepts `prompt.create`; other mutation families and the download protocol belong to later slices. `GET /api/v1/library/prompts` returns bounded summaries and full content comes from its identity route. Canonicalization version 1 hashes decoded, fixed-order identity/envelope/operation fields and trimmed title/description, preserving content. Receipt replay remains possible without storing historical prompt bodies in receipts.

The browser retains drafts in memory only. It locks a transmitted draft while delivery is uncertain, retaining Retry and Copy text until acceptance or a definitive refusal. Account and instance identities key views. Clipboard line endings are normalized by the Windows system clipboard; REST and persisted content remain exact.

## Validation notes

On 2026-09-20, the production-build REST, Chrome and restart runner passed all 13 tests (99 assertions) on Windows with Bun 1.4.2 and Next.js 16.3.5. The workspace suite passed 88 tests (unchanged prototype tests used Turbo's cache); the subsequently added account-scope client regression also passed in the targeted rerun. Workspace typechecking passed. All changed files pass Ultracite. The repository-wide lint command also reports pre-existing failures in `docs/research/search-parity/*.mjs`, outside this change.

React Doctor 0.9.14 was invoked with Bun and `--verbose --scope changed`; its standalone CLI failed in child-process IPC (`child.channel?.unref is not a function`) before producing a score. The repository's configured React Doctor Oxlint plugin checks pass for changed files. No Node runtime fallback was introduced.

The Matt Pocock review compared the complete staged change with task-start commit `ab9a8f73303d4f260dd865d4582e5e03fce7747c` in independent Standards and Spec passes. Both reported zero actionable findings. The account-switch fix received a separate follow-up review.
