# Issue #33: web collections

Validated on Windows on 2026-09-20 with Bun 1.4.2, Next.js 16.3.5, the isolated PostgreSQL/SMTP Compose fixture, and headless installed Chrome through Playwright. Implementation base: `810ed8c1fc5ffdee9f20d853b01bc44095116f64`.

## Implemented behavior

- Library-owned flat collection creation and rename use the existing serialized mutation envelope, dependency checks, frozen request fingerprints, compact receipts, change records and atomic quota accounting. Migration 011 registers collection ownership keys and prompt assignment foreign keys.
- Optional single collection assignment is available in Create/Edit prompt. Changes advance prompt modification dates; unchanged assignment and collection rename do not. Duplication and conflict preservation keep valid organization. Competing assignment acceptance includes a replayable supersession notice.
- The Collections tab of Manage collections and tags has creation, rename, canonical name search, alphabetical rows, Unused and active/archive/total counts. Complete searchable assignment and filter pickers expose all 200 entries. Count warnings begin at 180; names share the 100 MiB text quota with prompts.
- Unicode 17 data, generated TypeScript/Rust tables and literal conformance vectors live in `packages/api-contract`. Identity retains accents and internal spacing; search normalization is separate. Names retain entered text after errors.
- Modal focus containment/restoration, explicit draft discard, uncertain-delivery replay and before-unload/sign-out protection preserve the open-tab draft.

## Verification

| Check | Result |
| --- | --- |
| `bun run typecheck` | Passed across all six typed workspaces |
| `bun run test` | 95 tests passed (66 prototype, 22 API client, 7 web) |
| `bun --env-file=apps/web/tests/social.env apps/web/tests/collections-runner.ts` | 67 REST/browser tests passed; 1 additional restart test passed |
| Post-review collection and prompt-edit acceptance run | 32 tests passed across four files, including two new regressions for combined text/assignment conflicts and successor drafts |
| Ultracite on changed TypeScript/TSX/JSON files | Passed, including the configured React Doctor rules |
| Unicode 17 NormalizationTest corpus | 20,034 identity vectors agreed with an independent Bun ICU reference calculation; production uses only pinned tables |
| `bun x --bun react-doctor@latest --verbose --scope changed` | CLI 0.9.14 failed under Bun/Windows with `child.channel?.unref is not a function`; no standalone score available |

The production-build acceptance runner covers 179/180/200 collection boundaries, shared text quota, capitalization and canonical collisions, malformed scalars, 60/61 supplementary-code-point names, ownership denial, dependent rejected work, frozen payload correction, once-only retry, rename dates, moving/unassigning, archive counts, conflict copies, complete entry reachability and server restart.

The maximum-count browser fixture contains **10,000 prompts and 200 collections**. Keyboard search reaches the final entry, Unused excludes archive-only assignments, renaming retains the selected identity, and closing restores the invoking focus without clearing the underlying view, picker search or selected prompt. A separate browser check drops a successful response and verifies byte-identical retry.

Screenshots: [management](../evidence/issue-33-collections.png) and [capacity refusal with retained input](../evidence/issue-33-capacity.png).

## Standards review

Two P3 findings were corrected: collection limits and Hangul normalization parameters now use named constants, and REST handlers receive a discriminated target instead of positional flags. The independent re-review found no remaining actionable findings.

## Spec review

One P2 finding was corrected: collection supersession notices now remain visible alongside text-conflict preservation and retained successor-draft messages. Both browser regressions failed before the fix and passed afterward. The independent re-review found no remaining findings in this ticket's scope.

Review totals: Standards 0 remaining (2 P3 resolved); Spec 0 remaining (1 P2 resolved).

This ticket does not implement tag operations or collection deletion, which are separate slices. Native permissions are unchanged. These checks do not certify installed-desktop behavior, screen-reader use, or the full release latency budgets.
