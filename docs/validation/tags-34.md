# Issue #34: web tag management and assignment

Validated on Windows on 2026-09-20 with Bun 1.4.2, Next.js 16.3.5, the isolated PostgreSQL/SMTP Compose fixture, and installed Chrome through Playwright. Implementation base: `5d2ba9ef2bdfc65c05fd12bdcc9b148dd4aea78f`.

## Implemented behavior

- Migration 012 adds library-owned tags, quota counters, compact mutation receipts, change records, and persisted per-prompt membership add/removal revisions. Every operation uses the existing serialized library transaction and rollback boundary.
- Typed `tag.create` and `tag.rename` mutations use the shared Unicode 17 organization identity. Equivalent creation resolves to the existing tag, preserves its display capitalization, and names that tag in the acknowledgement without assigning it. Colliding rename requires the future explicit merge flow.
- `prompt.tags` submits independent add/remove deltas. An add that has not observed a retained removal is ignored with a replayable notice; a deliberate re-add after observing it succeeds. Detail reads expose the library snapshot revision alongside memberships, including no-op removals. Actual membership changes alone change prompt dates; renaming a tag leaves prompt dates untouched.
- Tags remain after their last assignment is removed. Complete searchable pickers and the Tags management tab expose up to 1,000 entries, alphabetical name order, Unused, and library-wide active/archive/total counts. Identity filtering combines selected tags with AND and binds signed pagination cursors to that filter.
- Names allow 60 Unicode code points; a library allows 1,000 tags and a prompt 20 assignments. Warnings begin at 900 tags. Names share the existing 100 MiB text quota. Capacity refusals retain input; shorter renames and equivalent creation remain possible at capacity.
- Creation and duplication carry submitted membership snapshots. Omitted legacy snapshots are empty; later source assignments cannot change a delayed duplicate. Required text-conflict and deletion-conflict copies retain valid tags.
- Keyboard controls, modal focus restoration, retained drafts, explicit discard, and retry of the frozen original operation cover management and assignment. Accepted saves refresh canonical detail before list reset and completion, preventing a following duplicate from using a stale saved snapshot.

## Verification

- `bun run test`: 96 tests passed (66 prototype, 23 API client, 7 web).
- `bun run --cwd apps/web test:tags`: 91 REST/browser acceptance and regression tests passed, followed by 1 passing restart-persistence test (468 assertions total).
- `bun run typecheck`: all six typed workspaces passed. The production acceptance build also runs TypeScript.
- Changed-file Ultracite formatting/lint passed, including configured React Doctor rules.
- `bun run lint` remains blocked by pre-existing formatting in seven unrelated files and lint errors in `docs/research/search-parity/*.mjs`; those files are unchanged by this ticket.
- Standalone `bun x --bun react-doctor@latest --verbose --scope changed` (CLI 0.9.14) fails under Bun/Windows with `child.channel?.unref is not a function`. No Node runtime fallback was introduced.

The acceptance command is `bun run --cwd apps/web test:tags`. It builds the production app, runs tag REST/browser tests and the existing collection/prompt creation, editing, lifecycle, deletion, and capacity regressions, then restarts the server and verifies persisted tag receipts and removal baselines. Test services are isolated and removed afterward.

Coverage includes equivalent-creation races, the shared Unicode identity fixtures (including distinctions search may fold), supplementary-code-point and malformed-scalar boundaries, shared text quota, ownership, 20-tag atomic refusals, delayed duplicate snapshots, conflict preservation, filter cursor binding, unused retention, archive counts, all 1,000 picker entries, keyboard assignment, and lost-response retry.

A held-response browser regression also covers editing one prompt, selecting another, then saving the retained editor: detail actions remain disabled until the saved prompt's refreshed snapshot is available, and duplication uses that saved content.

Screenshots: [unused tag management](../evidence/issue-34-tags.png) and [capacity refusal with retained input](../evidence/issue-34-capacity.png).

## Standards review

The independent review found one low-priority naming issue. The shared manager and save hook now use organization names, and tag props use the `Tag` domain type. Follow-up review found no remaining standards findings.

## Spec review

Three findings were corrected: delayed duplicates now use only their submitted membership snapshot; equivalent creation identifies the canonical tag in the acknowledgement; and detail actions cannot use an old cached snapshot while a saved prompt is refreshing. Independent follow-up review found no remaining spec findings.

Review totals: Standards 0 remaining (1 P3 resolved); Spec 0 remaining (3 findings resolved).

Tag merge and deletion remain separate slices. Native permissions are unchanged. These checks cover the web library; they do not certify installed-desktop or screen-reader behavior.
