# Persistence, synchronization, and shared API contract

Status: architecture decision specification for [Choose persistence, synchronization, and shared API contracts](https://github.com/Umami-Creative-GmbH/pr0/issues/10), settled through the live decision rounds and the user's authorization to complete the final search/storage comparison and apply the recommendations on 2026-09-19. This document supplies the concrete protocol defaults and acceptance cases for implementation. It does not claim production implementation or completed release validation.

## Authority and scope

The canonical product inputs are [prompt lifecycle](https://github.com/Umami-Creative-GmbH/pr0/issues/4#issuecomment-5742392967), [account access](https://github.com/Umami-Creative-GmbH/pr0/issues/5#issuecomment-5742474484), [offline reconciliation](https://github.com/Umami-Creative-GmbH/pr0/issues/6#issuecomment-5742539348), [retrieval](https://github.com/Umami-Creative-GmbH/pr0/issues/7#issuecomment-5742642457), and [operating envelope](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995). Those decisions remain authoritative; this contract supplies their mechanisms and the refinements explicitly accepted in the architecture discussion.

No production feature, operator provisioning, visible version history, or collaboration model is introduced by this specification. Variable substitution was outside the original decision; the [issue #21 amendment](#variable-substitution-amendment-issue-21) records its subsequent scope and contract rules. PostgreSQL, Next.js REST handlers running under Bun, Tauri/Rust, shared contracts/client/UI, and TanStack Query remain the foundation. No Redis is required.

## Components and ownership

| Boundary | Responsibility |
| --- | --- |
| Next.js REST handlers | Authenticate each request, validate contracts, enforce library ownership, run mutations and expose snapshots/change feeds |
| PostgreSQL | Durable accounts, library state, revisions, operation receipts, deletion markers, merge aliases, conflict notices and synchronization records |
| Server SQLite search index | Rebuildable, revision-bound projection of PostgreSQL; exact retrieval in Bun workers, with no independent write authority |
| Bun SQL | Server connections, parameterized SQL and transaction affinity; no browser or desktop frontend imports |
| Better Auth / Drizzle adapter | Auth schema and session/device-flow storage over the same Bun-native PostgreSQL client, with adapter transactions explicitly enabled |
| Rust desktop service | SQLite ownership, credentials, authenticated HTTP, synchronization, clipboard and native authorization boundary |
| SQLite | Downloaded baseline, visible local projections, pending work, operation dependencies, local revisions, usage delivery and recovery metadata |
| Shared contracts | Zod/OpenAPI, encoding/validation rules, canonical normalization, comparison and fixtures; no server/native dependencies |
| Shared client | Validated REST and TanStack Query integration; desktop supplies typed native operations instead of exposing a generic authenticated fetch proxy |
| Shared UI | Rendering and interaction; query caches are disposable views, never evidence of durable saving |

Validated research candidates are Better Auth and its Drizzle adapter 1.7.5, Drizzle ORM 0.45.2/Kit 0.31.10, Bun 1.4.2 and PostgreSQL 17.10; rusqlite 0.40.2 with bundled SQLite 3.53.2; windows-sys 0.61.2. Use the research lockfiles as the initial compatibility baseline, and rerun the compatibility checks when pins change. Exact deployment container selection remains with deployment.

Evidence assets: [authentication and fresh-auth primitives](https://github.com/Umami-Creative-GmbH/pr0/blob/7c780b404455e211ffbc6bd0bbd599dce2451416/docs/research/better-auth-bun-validation.md), [native persistence and credentials](https://github.com/Umami-Creative-GmbH/pr0/blob/fd5359098de065baf0bc0dcbc2a11fea94c8e6db/docs/research/native-persistence-validation.md), and [search parity and bounded index design](https://github.com/Umami-Creative-GmbH/pr0/blob/988d2cfed31068603cebdb7ed1f9cdf28d3558a7/docs/research/search-parity-validation.md). The assets distinguish measured primitives, negative findings and unimplemented integration/release tests.

## Identities, clocks, and persisted records

- An instance has a persisted, immutable opaque identity independent of its URL. An account has an immutable identity independent of its email. Object references and operations always belong to both. Recreating an account never reuses its identity.
- Clients generate UUIDv4 identities for prompts, tags, collections and operations. Server-created conflict copies/notices also receive stable identities. A used or deleted object identity is never reused.
- Each library has a monotonically increasing 64-bit revision. Increment it under the library write lock inside the committing transaction; serialize revisions as decimal strings in JSON. Dates are not revision numbers.
- Each logical instance recovery generation has an opaque epoch. A disaster restore must establish a new epoch before serving clients. A cursor or receipt from another epoch cannot be mistaken for a current checkpoint.
- Creation and modification dates become authoritative at server acceptance, in UTC with millisecond precision. Offline dates are provisional. Unchanged saves and usage do not advance modification dates. Actual assignment changes do; merely renaming referenced organization does not.
- Prompt text fields and favorite/archive/collection metadata carry last-change revisions. Tag membership retains presence/removal revision metadata, including removals. Retain organization deletion markers and merge aliases for the account lifetime.
- Keep synchronized baseline, latest locally saved projection and pending work logically separate. A baseline download is not permission to replace saved local work.

The relational model includes a library serialization/quota row, prompts, collections, tags, memberships, entity deletion markers, tag aliases, operation receipts, conflict notices, change records, snapshot metadata, and auth/session/reauthentication records. Foreign keys and uniqueness constraints include library ownership. Do not rely only on IDs that happen to be globally unique.

## Local saves and the outbox

One Rust storage worker owns the writable connection for the active partition. Other windows issue typed commands. Resolve paths from the application-local-data directory in Rust using opaque account/instance identifiers; renderer input cannot choose a filesystem path or active account.

Prompt storage uses ordinary, unencrypted SQLite under the current Windows user's directory permissions. Application-level database encryption is outside this decision; verify the effective directory/file ACLs on installation and migration. Credential Manager protects session credentials separately. Credential protection does not encrypt prompt text, and local storage does not promise protection from another process already running as the same Windows user.

Set and verify WAL, `synchronous=FULL` and per-connection foreign keys. Use a bounded busy timeout and bounded whole-operation retries that fit the save budget. Keep blocking SQLite work off the UI thread. Never span HTTP, clipboard access, or human interaction with a database transaction.

A local save transaction checks the partition generation and expected local revision, validates the intended state and known quotas, updates the local projection and its required search state, and writes the pending operation with its baseline and dependency references. Only successful commit permits “Saved on this device.” Emit invalidations after commit. A stale local window receives a revision conflict and keeps its draft rather than silently replacing a newer local save.

Unsent edits to the same object may be coalesced into the latest saved variant. Once an operation is transmitted, freeze its UUID and payload. Further edits form successor work. Persist the in-flight state before sending; a process crash retries that exact operation. Applying an acknowledgement, updating the baseline, removing/advancing the outbox entry and rebasing a successor is another local transaction. An acknowledgement must not clear a successor or overwrite an open unsaved draft.

An accepted receipt may arrive before the corresponding canonical records. In that case retain the saved variant as `accepted_awaiting_download`; do not remove the visible overlay until records at or after the accepted revision have been applied. A replayed old receipt reports its original outcome, not permission to restore old row contents. Read current records/change pages before replacing a projection, and respect later deletion. Cap response size by returning receipts plus continuation/read instructions when full canonical records would not fit.

If an in-flight text edit becomes a conflict copy, associate any later local edits of that variant with the returned conflict-copy identity; refresh the original separately. Record that mapping and successor adjustment atomically, and tell the user the edit continues on the preserved copy. Operations depending on a rejected collection/tag creation wait; unrelated operations continue.

On disk-full, I/O, failed commit or uncertain connection state, report “Not saved,” retain the editor draft, and stop claiming durable progress. Retire/reopen an uncertain connection after rollback handling. Never repair by deleting WAL files, clearing the outbox, or silently downloading an empty replacement database. Preserve a corrupt database and recovery files; recovery from disk loss is outside the normal durable-save guarantee.

## Operation envelope and once-only effects

The mutation envelope contains protocol version, instance/account identity, recovery epoch, client installation identity, and an ordered list of operations. Each operation contains UUID, operation kind, target identity, base revision, changed fields, required baseline values, full desired text variant where preservation may be necessary, and explicit dependencies on prior operations. Full desired text means title, description and content, not a patch that becomes unusable if the original is deleted.

Representative shape, with revision values serialized as strings:

```json
{
  "operationId": "<uuid>",
  "kind": "prompt.update",
  "promptId": "<uuid>",
  "baseRevision": "41",
  "changedFields": ["content"],
  "base": { "title": "Reply", "description": "", "content": "Earlier text" },
  "desired": {
    "title": "Reply",
    "description": "",
    "content": "My saved edit"
  },
  "dependsOn": []
}
```

Operation kinds cover prompt create/update/delete/duplicate; collection create/rename/delete; tag create/rename/delete/merge; tag-assignment changes; prompt usage; and conflict-notice acknowledgement. Favorite, archive and collection changes are typed prompt fields. Server and desktop apply the same documented validation semantics.

Duplication carries the source snapshot selected by the user and a new prompt identity; it is an independent create, not a delayed instruction to copy whatever the source contains when the server eventually receives it. Deletion or later editing of the source does not silently change that saved duplicate.

For each operation, begin a short transaction, acquire the library serialization lock, recheck the current account state and ownership under that lock, and look up the operation receipt. Account deletion uses the same lock when entering deletion-pending, preventing a mutation checked earlier from committing after the deletion barrier. The same UUID plus the same canonical request hash returns the original accepted outcome; a different payload under that UUID returns `operation_identity_reused`. Never execute the effect twice. Hash canonical decoded content, with a fixed canonicalization version, not arbitrary JSON property order.

Reconcile, check resultant quotas and valid references, and atomically commit all effects, generated copies/notices, usage adjustment, quota counters, change records and the receipt. A rollback commits none of them. Each batch entry has its own transaction; one rejection cannot roll back earlier accepted unrelated entries. Receipts retain compact outcome/identity/revision/accepted-time information, not permanent copies of deleted prompt text.

Temporary failures and quota-blocked unchanged operations may retry with their existing identity. Correcting an operation's content requires a new identity after its previous outcome is known. Resolve uncertain delivery by receipt lookup or replay before changing a transmitted payload. Explicitly discarding local pending work stops delivery but cannot undo an effect already committed by the server.

## Reconciliation rules

1. Validate authority, immutable identities and dependencies before reconciliation. Never infer an account from email or import queued work into a newly selected account.
2. Compare changed text fields against the retained baseline and current server values. Identical desired/current values need no conflict. A field unchanged on the server can accept the incoming change. Concurrent different text preserves the server's accepted text in the original and the incoming complete text variant in a conflict copy; combine independent field changes into the original.
3. A conflict copy is an independent active, unfavorited prompt with fresh authoritative dates and no usage. Preserve valid organization. Generate a stable copy identity in the same transaction and return it in the operation receipt.
4. Keep the full incoming source title in conflict details when the generated suffix requires shortening its displayed title. Include retained text in quota accounting. This avoids losing a competing title merely to label the copy. Acknowledging a notice does not delete the copy or retained title text.
5. Favorite/archive/collection competition uses server acceptance order, with a notice for a superseded organization choice. Incoming unchanged values do not manufacture a competing edit. Independent text and archive changes combine.
6. Tag assignment changes apply as deltas. Different tags combine; an add based on a revision preceding a removal of the same membership loses to that removal. A deliberate re-add after observing removal is valid. Keep the removal revision needed to make that distinction.
7. True tag/collection deletion wins over stale renames or assignments. Clear invalid references while preserving prompts and explaining adjustments. Equivalent tag creations converge to the existing tag and return an identity mapping. Collection collisions remain rejected local work until renamed. Tag rename collisions require explicit merge approval.
8. Explicit tag merge preserves an alias from source to target for pending assignment reconciliation. Follow aliases only within the library, detect cycles, and stop at a deleted target. A stale source rename cannot rename the target. If the final target was deleted, deletion wins.
9. A text edit arriving after deletion preserves the incoming variant as a conflict copy without resurrecting the old identity. Metadata-only changes or usage do not recreate a deleted prompt.
10. A stale deletion arriving after an unseen accepted text edit preserves that current edited variant in a conflict copy before deleting the original. Thus either arrival order preserves unseen text. If required preservation cannot commit, leave server state unchanged and retain the rejected pending deletion locally.
11. When required conflict preservation exceeds a quota, keep the pending variant locally with an actionable error. Do not acknowledge success, clear the pending entry, or silently choose one text. A web tab retains its unsaved draft under the existing browser guarantee; it has no offline-restart durability promise.
12. If a safe baseline cannot be established, preserve the variant for review rather than overwrite the server. Missing historical change pages do not by themselves make the local baseline unusable: retained baseline values, current records, deletion markers and receipts remain available.

Bulk organization deletion/merge must be submitted as a singleton batch. Bound its work by the supported library size. Represent bulk relation cleanup explicitly in the change feed so one operation does not require an unbounded response; affected prompt modification and field revisions still change consistently. The actual maximum-size bulk transaction must pass failure/recovery and responsiveness validation.

### Concrete protocol traces

| Starting state and delivery | Required outcome |
| --- | --- |
| Both devices saw revision 40. A changes title and commits 41; B changes content from 40. | B's operation commits 42 with A's title and B's content in the original. No copy. |
| Both saw content `old` at 40. A commits `A` at 41; B submits `B`. | Keep `A` in the original; create one independent copy of B's complete text. Receipt maps B's operation UUID to that copy. Repeating B creates nothing further. |
| B sends `B1`, then locally saves `B2` while the request is unresolved. The first operation produces copy C. | Map the B variant to C and retarget/rebase the unsent successor; retain `B2`. Neither the old receipt nor incoming original state can erase it. |
| A deletes original P at 41; B submits a description edit based on 40. | P stays deleted. Preserve B's full variant in new copy C. If C cannot fit, reject atomically and retain B locally. |
| A edits P at 41; B submits a deletion based on 40 without seeing A. | Preserve current P as C, then delete P in the same transaction. A quota/storage failure performs neither effect and leaves B's deletion pending. |
| A removes tag T at 41; B adds T based on 40. B later observes 41 and deliberately adds T. | First add loses to removal; the later causally informed add is allowed. |
| A merges Draft into Writing; B's queued assignment names Draft. | Resolve the alias to Writing. If Writing was subsequently deleted, clear the invalid assignment with notice. Do not recreate Draft or rename Writing. |
| Create X commits but its response is lost; X is subsequently deleted before the original client retries. | Return the create's original receipt, reconcile current X as deleted, and never recreate X. A newer local text edit is separately preserved under deletion conflict rules. |
| A collection create is rejected for a name collision; its prompt creation depends on it. An unrelated favorite operation is in the same batch. | Keep collection/prompt work locally with dependency status; accept the unrelated favorite. Renaming creates corrected unsent work with explicit identity/dependency handling. |
| Device returns after the change feed expired, with pending operation O and an old baseline. | Stage a fresh snapshot, retain O, check its receipt, then reconcile it against current records/deletions. Missing change pages never authorize dropping O. |
| Old account was deleted; another account now uses its email. | Verify the old account's deletion receipt and clear only its partition. Never submit its operations using the new account's session. |

These traces are specification walkthroughs, not claims that an implemented synchronization engine passed them.

## Snapshots, cursors, notifications, and recovery

Change records live for 90 days. Retain compact entity deletions, tag aliases, membership removals and deduplication records for the account lifetime. Account deletion removes those account records; only the separate minimal account-deletion evidence survives. Historical metadata growth is not included in the logical library-text quota and must be included in operator storage monitoring/capacity planning.

A cursor is opaque and integrity protected, bound to instance/account, recovery epoch, schema/normalization versions and the last fully applied library revision. A change page ends at a complete operation boundary and supplies its next cursor. If an operation's bulk effects require a compact semantic event, apply that event and cursor in one local transaction. Replaying a page is safe. Never advance a cursor before its data commits.

Use HTTPS long polling with one outstanding poll per active client coordinator and a maximum 25-second wait. Do not hold a database transaction or dedicated pooled connection during the wait. Notifications are wake-up hints; committed change records and the cursor determine truth. Check the cursor again when registering a waiter to prevent a missed-change race. Reconnect, foreground activation and local saves trigger immediate work. After a notification, fetch/apply bounded pages until caught up. Back off temporary errors with jitter and honor server retry delays.

Expired or incompatible cursors return `snapshot_required`. Create a consistent snapshot at a named revision, without keeping a transaction open across HTTP page requests. Materialize a bounded, temporary snapshot under account isolation; reuse it where possible and expire it after 15 minutes. Pages are at most 4 MiB of uncompressed JSON and have a manifest/page count and content digests. A new setup may expose downloaded prompts with progress and accept local edits into its separate outbox; it must not claim completeness. For replacement snapshots, retain the existing usable library until staging completes. Apply intervening changes after the snapshot cut, then atomically switch the baseline while retaining/reconciling pending work.

Cancellation, disconnect, expiry or insufficient scratch space preserves existing data and pending work. An expired materialized snapshot restarts from a new manifest. It does not clear the old partition. Authenticate and check account deletion before uploading any pending work, including after reauthentication or recovery.

A disaster restore changes the recovery epoch, reapplies account-deletion evidence before opening service, and forces a fresh snapshot. Preserve local pending work and a recoverable pre-refresh local snapshot; do not automatically re-upload every previously acknowledged row. The accepted one-hour disaster RPO is distinct from ordinary synchronization. Unknown restored targets require explicit preservation/recovery, never cross-account import or identity resurrection.

## Search and pagination

Accepted semantic contract: a pinned, versioned normalization specification shared by web/server/desktop; explicit code-point ordering; literal substring matching; cross-field AND; the six existing relevance tiers and deterministic tie-breakers. Indexes may accelerate this but may not change eligibility, punctuation, short-query behavior or result order.

The normalization contract is `pr0-search-v1-ucd17`: validate scalar text; apply Unicode 17.0 NFD, default full case-fold mappings C/F (not Turkic T), and NFD again; remove only characters whose General_Category is Mark and whose Diacritic property is Yes; map Unicode White_Space runs to ASCII space and trim the ends. This preserves variation selectors and unrelated combining marks. Do not use NFKD, locale-sensitive lowercasing or punctuation removal. Split queries on normalized spaces and deduplicate terms for matching, while retaining the entire normalized query for exact-title relevance. Full case folding supplies sharp-s matching; it does not make `ueber` equal `uber`.

Preserve original stored text. Organization identity is a separate Unicode 17 contract: trim outer White_Space, normalize canonically, apply default full case folding and normalize canonically again, retain accents and internal spacing. Use canonical NFC for its stored identity key. Do not use accent-insensitive search keys as unique tag/collection keys. Contract data and conformance vectors live with the shared contracts; generate version-pinned Rust/TypeScript tables from the same Unicode inputs. A browser's own changing ICU implementation is not the definition of the protocol.

Compare normalized title strings lexicographically by Unicode scalar values, then UUID bytes. Valid UTF-8 binary order can implement the scalar comparator. Do not use JavaScript's default UTF-16 ordering or locale-sensitive database collation. Use shared fixture vectors for supplementary characters, composed/decomposed accents, German sharp s, punctuation and whitespace. Reject unpaired surrogates and NUL before storage.

The initial PostgreSQL/SQLite trigram-plus-scan plan passed semantic fixtures but missed the 150 ms maximum-library target for several short/common queries. A full positional SQLite index improved timings but used excessive space. The selected replacement uses compact per-field trigram candidate indexes, exact rechecks, persisted adaptive postings for short terms, and ordered page evaluation. Rechecking every long term separately is not the selected execution plan: it repeatedly reads large bodies and leaves insufficient latency margin for common multi-term searches.

The compact predicate passed 1,368 field comparisons and sixty native checks. On two synthetic 10,000-row/100 MiB corpora, the final batched ordered path measured approximately 4–10 ms p95 for common/cross-field searches, 53.2 ms for an absent term with 4,283 false-positive candidates, and 77.1 ms for a 197-code-point query containing twenty-five common terms. These observations establish a feasible candidate, not compliance on the supported hardware or a worst-case bound: they exclude UI/debounce/network, full-field and concurrent-host costs. The 150 ms complete-search target remains a release gate, including those harder queries.

Use the same logical derived SQLite index in Bun server workers and the Rust desktop service, keeping PostgreSQL authoritative on the server. Use separate external-content FTS5 tables for field classes with `detail=none`, `columnsize=0` and `trigram case_sensitive 1`. For each normalized term of at least three code points, split into distinct overlapping three-code-point grams and intersect their quoted literal matches, doubling embedded quotes. Never pass raw user query syntax or a longer phrase directly to this compact index. These are candidate hits only: lost positions allow false positives, so verify the original normalized term with an exact substring predicate against the corresponding field. One/two-code-point terms use exact persisted postings.

Combine field/term candidates with scope and filters, then evaluate the requested page in the full documented sort order. For Relevance, determine the highest possible tier from title, organization and description evidence before body checks; verify eligibility and actual tier before admitting a result. Read a candidate body at most once for all outstanding terms in that query, in batches bounded by both sixty-four rows and 4 MiB; persist normalized-value byte lengths to enforce that bound before fetching. Stop only when the page is full and no unseen candidate can outrank its last result under the complete tier/tie tuple; otherwise continue evaluating. Never impose an arbitrary candidate cap. For explicit sorts, verify candidates in that complete sort order. Title/content-only benchmark fixtures do not replace conformance tests for all six tiers, dates, usage, organization, filters and later pages.

Keep prompt text and organization name index records separate. Expand matching tag/collection identities through their current assignments when forming prompt hit sets. A tag rename changes its name index rather than reindexing every referenced prompt's content; usage/favorite/archive changes update compact metadata, not text. All parts observed by one query come from one SQLite read transaction at one index revision.

For short-term posting keys, persist the smallest payload representation: sorted unsigned 16-bit slots (`2d` bytes for d entries), a bitmap (1,250 bytes for 10,000 slots), or sorted unsigned 16-bit start/length runs (`4r` bytes for r runs). Organization postings use their bounded organization slot domain and expand through membership maps. Persist representation tags, counts and index/normalization versions. Slots are local index addresses, never public identities; remove old postings/mappings transactionally before reuse. Sparse representation prevents allocating a full bitmap for every rare Unicode gram, while dictionary/page overhead remains data-dependent.

Load only query keys and compact metadata; do not retain every prompt body in an unbounded process cache. Cache budgets are 512 MiB aggregate on the server and 256 MiB on desktop, covering SQLite page caches, decoded postings and metadata across all workers/connections. These are application cache budgets, not whole-process or OS-page-cache guarantees. Start with at most two server search workers on the provisional two-vCPU host and one desktop storage owner, with serialized writers per library, bounded admission and cancellation of obsolete typeahead queries. Validate runtime overhead and concurrent tenant behavior in the release workload.

The compact candidate index used approximately 77.0 MiB for the original noisy 100 MiB corpus, compared with 508.6 MiB for its positional counterpart. Including the normalized source table, the compact derived database used approximately 194.3 MiB, before short postings and operational overhead. A separately labeled synthetic prose corpus used approximately 4.19 MiB of index and 117.3 MiB of source table; it is not a sample of real user libraries.

Use **64 GiB as the provisional full-workload validation allocation**, replacing the earlier 128 GiB proposal. Scaling the noisy fixture to 10 GiB logical text suggests approximately 19.4 GiB of derived storage plus canonical PostgreSQL data, before PostgreSQL/index overhead, receipts, snapshots, WAL and scratch space. Forty GiB is too tight to assume that workload fits with the accepted reserve thresholds. A smaller deployment may start smaller and expand with measured use; 64 GiB is not a minimum installation requirement or a worst-case guarantee for arbitrary Unicode/cardinality/history. Preserve alerts at 70% and expansion before 80%. Stage rebuilds by library with bounded concurrency and preflight measured scratch needs; do not assume room for a simultaneous second copy of every index. Actual host allocation and backup volumes remain the deployment decision.

### Projection consistency and rebuilding

On desktop, update the visible prompt projection, exact postings, compact candidate index, metadata, local projection revision and outbox in the same Rust-owned transaction. A query/cache key uses the local projection revision, so offline changes invalidate results even when the last server revision is unchanged. Persist compatible indexes across ordinary restarts; do not rebuild 100 MiB of text at every startup.

On the server, PostgreSQL commits remain the only durable library write authority. An index worker reads the durable change log and applies each complete change with its applied-server-revision marker in one SQLite transaction. A PostgreSQL commit is not rolled back or repeated merely because indexing subsequently fails. Queue/retry projection work and retain the canonical change feed; after a crash, resume from the persisted marker. No distributed transaction between the two databases is assumed.

At search admission, authenticate and obtain the current committed library revision R. Read the index only once it has applied at least R, and return the actual consistent index revision S used by the query. Catch up promptly; if unavailable, return explicit `search_preparing`/retry state rather than silently reporting stale results as current. Recheck active account/partition generation before emitting a delayed response. Cache entries bind instance, account, recovery epoch, normalization version and applied revision; an entry from another tenant/revision is unusable. Notification loss cannot lose indexing work because the PostgreSQL cursor is authoritative.

Index update failure, corruption, an expired catch-up cursor or incompatible normalization triggers a staged rebuild from a consistent canonical snapshot followed by change-log catch-up. Atomically switch the ready projection and its marker, then reclaim the old derived files after readers release them. PostgreSQL data and receipts remain intact. Server startup reopens compatible persisted indexes and catches up; disaster restore changes the epoch and gates search until rebuilt. Account deletion cancels its workers, evicts its caches and removes its server index as part of purging live data.

Preflight real file and scratch requirements before snapshot/index migration. On desktop, preserve authoritative SQLite/outbox data and show explicit search preparation or recovery status if its derived index cannot be read; never clear primary data to make an index rebuild succeed. Persisted cold-start, real incremental updates, all organization fields, Unicode-heavy dictionary growth and memory pressure remain release tests.

Search pages are bounded (default 50, maximum 100 rows) and return summaries rather than full prompt bodies. Fetch full text by prompt identity for editing/copying. Bind a page cursor to query/filter/sort, normalization version and library revision. On a changed revision, return `results_changed` and restart from the first page while preserving selection by identity; do not silently mix pages from different orderings. Pagination must not impose a fixed total limit on Recents. Use a separate stable snapshot protocol for bulk library download.

## Variable substitution amendment (issue #21)

Status: approved amendment for [issue #21](https://github.com/Umami-Creative-GmbH/pr0/issues/21), following eleven accepted live decisions and final confirmation of the consolidated specification on 2026-09-19. The [variable substitution and copying specification](variable-substitution-copy.md) supplies the grammar, interaction rules, and acceptance cases. It extends the original issue #10 scope without introducing template-value persistence.

Store prompt templates, including optional `string`/`number` annotations, as ordinary content. Share identical placeholder parsing, first-appearance ordering, repeated-name type aggregation, literal escaping, validation, and one-pass substitution semantics across web and desktop. Malformed placeholders remain literal saved text. Existing literal search operates on stored templates; filled values and clipboard output are not indexed.

Variable values are required, transient client input. Do not persist or synchronize them or substituted output in database records, browser storage, outboxes, receipts, usage metadata, backups, logs, telemetry, URLs, or application-controlled crash attachments. Clear them at the interaction boundaries defined in the linked specification. No new REST operation, durable record, or migration is required. Existing OS clipboard behavior is outside application retention guarantees.

Bound each value and the final expanded output at 256 KiB of UTF-8 text, reject malformed Unicode and NUL, and never truncate. Count repeated substitutions toward the output bound. These are copy-validation limits; the existing stored-content, total-library, and request limits are unchanged. Typed number validation preserves the original decimal text without floating-point conversion.

Use the latest locally available prompt and partition state to check authority, eligibility, and template changes before beginning the write. Desktop Rust retains native authority over clipboard access. Filled values never cross to another account/instance. In-flight clipboard completion stays bound to its originating identity and cannot update the newly selected account. No database transaction spans clipboard access, and an OS write already started cannot be rolled back.

Only a successful write creates the existing prompt-usage operation. Substitution does not edit the stored template, update modification time, or create a new prompt. Clipboard failure retains the values for explicit retry and creates no use; usage-storage failure after clipboard success retains success and retries only usage delivery. Conformance and interaction acceptance cases in the linked specification supplement the existing implementation/release tests. The final readiness decision must link this amendment.

## Usage and time validation

Each successful clipboard write generates a UUID usage operation with prompt identity and occurrence time. Store the local recency change and pending event together after the write. A failed clipboard write produces no usage. If the clipboard succeeded but usage storage failed, keep copy success, report the separate failure, and keep a best-effort in-memory retry without promising restart survival.

Represent occurrence time as a validated UTC instant with millisecond precision. Cap future times at first server acceptance; retain that accepted time in the receipt so a replay cannot move it forward. Update latest use with the maximum accepted occurrence time. Old events do not move it backward. Usage does not change prompt modification time or resurrect deleted prompts. Archived prompts retain usage without appearing in active Recents. A server correction replaces the provisional local event time and may reorder results.

Reject malformed/out-of-representation timestamps explicitly. Do not reject an otherwise valid old timestamp merely because a device was offline for months. No perfect cross-device chronology is promised for wrong device clocks. The receipt handles once-only event delivery; no detailed permanent usage-history product is added.

## Validation, quotas, and errors

Character limits count Unicode code points; text quotas count actual stored UTF-8 bytes. Reject malformed Unicode and U+0000 with field errors while preserving drafts. Apply existing required/trim rules to titles/descriptions and organization names; preserve nonblank prompt content exactly. Generated suffixes shorten only the derived title on code-point boundaries.

Enforce 10,000 prompts including archive, 256 KiB content per prompt, 100 MiB total library text, 200-character titles, 2,000-character descriptions, 60-character organization names, 1,000 tags, 200 collections, 20 tags per prompt, and 200-character queries. Include retained conflict title text in stored-text accounting. Warn at 90%; archiving frees nothing. Server quota checks and counters occur in the same serialized transaction as the operation. Allow deletions and usage-reducing changes even at a quota. Preserve work rejected because another device consumed capacity.

A request is bounded by both 100 operations and 4 MiB of uncompressed JSON; enforce decompressed size before unbounded allocation. Responses, change pages and snapshot pages are bounded too. Validate maximum strings before expensive normalization. Authentication/request limits remain 120 API requests/minute/account plus the existing signup/login/email controls. The initial work limiter is 1,200 mutation operations/minute/account with a 200-operation burst, and bounded server-wide admission/concurrency; this prevents a batch endpoint from bypassing work limits while allowing the 1,000-operation catch-up workload. Bulk organization operations remain singleton requests with library-size work bounds. Overload returns a retry delay rather than accepting work that cannot be processed safely. Deployment may tune these operational bounds against the required workloads without relaxing data-preservation or abuse requirements.

Errors contain stable code, human-readable message, retryability, optional field errors, operation identity and retry delay. Do not expose SQL, tokens or other accounts' existence. Representative codes are `validation_failed`, `quota_exceeded`, `name_conflict`, `dependency_blocked`, `operation_identity_reused`, `authentication_required`, `account_suspended`, `update_required`, `snapshot_required`, `results_changed`, `rate_limited` and `temporarily_unavailable`. A local failure additionally distinguishes `not_saved` from `saved_pending_sync`. No generic error code is deletion proof.

Use ordinary HTTP 400/401/403/404/409/413/422/429/503 semantics at the request boundary, and a successful batch envelope with explicit per-operation outcomes when a valid batch contains rejected entries. Never label a mixed batch wholly synchronized. Cross-library object access returns a non-disclosing not-found/forbidden result before data is read or changed.

## REST and native boundaries

Version the application REST API under `/api/v1`. The concrete operation families are:

| Endpoint family | Purpose |
| --- | --- |
| `GET /capabilities` | Instance identity, protocol/normalization versions, limits, compatibility policy and deletion verification material |
| `GET /library/prompts`, `GET /library/prompts/{id}` | Validated search/filter/sort pagination and full prompt retrieval |
| `GET /library/organization`, `GET /library/conflicts` | Organization and persistent conflict review state |
| `POST /sync/mutations` | Typed library/usage/notice operations and their individual receipts |
| `POST /sync/receipts` | Bounded lookup of uncertain operation outcomes |
| `GET /sync/changes` | Cursor-based pages and bounded long-poll waiting |
| `POST /sync/snapshots`, `GET /sync/snapshots/{id}/pages/{page}` | Consistent, account-isolated download manifests/pages |
| `GET /account/sessions`, `POST /account/sessions/{id}/revoke` | Independent session visibility/revocation |
| `POST /account/reauth/challenges`, `POST /account/reauth/verify` | Browser-only explicit fresh-authentication proof |
| `GET /account/methods`, `POST /account/methods/link`, `POST /account/methods/remove` | Browser-only login methods; linking and removal require fresh authentication and preserve account/library ownership |
| `GET /account-deletions/{handle}` | Minimal signed deletion receipt, usable without an ordinary session |

Better Auth's own login/device/recovery/provider routes remain under their configured auth prefix, with application guards on sensitive endpoints. Account deletion/email/provider changes have explicit browser-only application flows. Published OpenAPI and validators must be generated/updated together with implementation; this proposal is not a claim those routes currently exist.

The web uses secure, HttpOnly cookies with CSRF/origin protection. Rust attaches the independent desktop bearer internally, only to the selected HTTPS origin. Disable authenticated redirects unless each destination is revalidated before forwarding credentials. Validate responses and active partition generation before applying them; late responses after sign-out/switch cannot affect the next account.

Declare custom Tauri commands explicitly in the app manifest and capabilities. The launcher gets search/copy/status and necessary lifecycle operations; account management and editing permissions belong only where required. Remote content does not receive native permissions. Avoid a generic authenticated-fetch command. Enforce endpoint, account and argument checks in Rust even when UI capabilities also restrict calls.

## Sessions and fresh authentication

Use Better Auth database sessions with thirty-day expiry, `updateAge: 0`, cookie caching disabled and explicit validation/renewal on every protected request. Normal renewal extends database expiry without rotating the opaque token. Browser session cookies are issued only at sign-in, with an absolute lifetime of 400 days; active users must sign in again when that cookie expires. Protected responses must not refresh or clear session cookies: a delayed response for a previous account must never overwrite a newer sign-in. Sign-out revokes the database session without clearing the browser cookie, which remains unusable until replaced at sign-in or expired. Existing cookies retain their original browser expiry until the next sign-in. Native credential replacement is needed on a new login, not every ordinary renewal.

Record session provenance server-side (browser/device), independent of whether a request happens to use a cookie or bearer header. A device credential copied into a cookie must not acquire browser-only privileges. Device approval/redemption produces an independent session. At-most-once code consumption does not guarantee token delivery: a lost redemption response may require a new approval flow. Retain local work and allow retry; an orphaned server session remains visible/revocable.

Store a compact versioned desktop credential envelope in a same-user Credential Manager record, bound to immutable instance/account/session identities. Keep it under the 2,560-byte native limit. Missing, inaccessible or invalid credentials stop authenticated sync and request login while preserving SQLite. A newly obtained credential must be durably stored before declaring persistent sign-in complete. Session expiry/revocation does not erase local data.

Sensitive actions require a server-owned proof of authentication within ten minutes for the same account and browser session. Password re-entry verifies the current account's credential. The social-only path sends a one-time code to the current verified email, bound to instance, account, browser session and email version. Use eight cryptographically random decimal digits. Expire after five minutes, allow three wrong attempts, invalidate previous challenges on resend, and include delivery in the existing verification-email throttles. Keep a keyed code digest, not a plaintext code; serialize failed-attempt updates and atomically consume the successful challenge with creation of the ten-minute proof.

Generic email-OTP checks, ordinary session renewal, social callbacks without fresh verification, and desktop approval cannot mint this proof. Guard both application wrappers and direct Better Auth sensitive routes. Revoke/expire proofs with their sessions and invalidate them on relevant email/account changes. A changed account during reauthentication fails rather than silently switching ownership.

## Account deletion and restoration safety

At initial trusted HTTPS setup, persist the instance verification key and a random 256-bit opaque deletion lookup handle separately from the session token. The handle grants no library access. Encode receipts as compact JWS with a fixed `typ` of `pr0-account-deletion+jws`, protected `kid`, and the fully specified `Ed25519` algorithm. Require an OKP/Ed25519 public key and verify the exact JWS signing input before parsing the payload. The payload contains `version: 1`, `instanceId`, `accountId`, `handle`, `deletionId` and `deletedAt`; it intentionally has no expiry. Reject a different type, algorithm, identity or key chain. This selects the standard [JOSE Ed25519 identifier](https://www.rfc-editor.org/rfc/rfc9864.html), using the [Ed25519 signature construction](https://www.rfc-editor.org/rfc/rfc8032.html); it does not invent a signature algorithm. The implementation must include interoperability and key-rotation test vectors.

Retain signed key-rotation continuity and deletion receipts indefinitely. Each rotation statement uses a different fixed message type, names the instance and old/new key IDs, and includes the new public key signed by the previously trusted key. Pin the initial trust anchor; a changed URL or key without verified continuity cannot authorize a wipe or an upload into a replacement instance. Loss of verification material leaves local work intact pending recovery. A replayed valid deletion receipt for that exact account remains valid because deletion is irreversible; a receipt for another account/instance is rejected. Receipt lookup never returns account data. A missing receipt returns an unsigned absence response, which has no deletion authority.

The deletion coordinator is idempotent. Mark the account deletion-pending to deny new library/session operations, append minimal deletion intent to independently durable storage, purge live account data and sessions, persist the signed completion receipt to that independent ledger, then confirm completion. A ledger failure leaves a visible retryable pending deletion, not a success. Once durable deletion intent exists, recovery completes the purge. Pending intent alone is not served as a signed completion receipt. A crash after purge but before receipt publication resumes from the durable intent without needing the removed account session. Do not serve a restored database before replaying all deletion evidence; an unavailable/incomplete ledger blocks restoration from opening to users.

Only opaque deletion evidence and verification metadata survive indefinitely, without email/profile/prompt content. Normal backups retain the already agreed thirty-day policy. The independently durable ledger has a zero-loss requirement for acknowledged account deletions, distinct from the one-hour ordinary data RPO; deployment must supply and rehearse that durability path.

On reconnect, check for positive deletion evidence and validate current account authority before upload. A verified matching deletion receipt triggers exact-partition cleanup, including pending work and credentials. Outage, unsigned not-found, suspended account, generic unauthorized response and expired session never do. Delete only the active account's exact resolved paths, and invalidate in-flight responses first. Cleanup errors remain visible and retryable.

## Compatibility and release validation

Negotiate protocol and normalization versions before upload. Support current desktop and releases from the preceding ninety days; the hosted server must retain compatible contracts throughout that window. A normalization upgrade therefore preserves the existing version during the window or serves both versions explicitly. Unsupported older clients, or a new client with no common protocol on an outdated self-hosted server, receive an actionable compatibility error without mutating local work. Maintain an ordered Rust migration chain; schema changes, data transforms and version updates commit together. Before substantial transforms, preflight scratch space and create a consistent SQLite backup including pending identities/baselines. Reject unknown newer local schemas; do not automatically downgrade them.

Server migrations are an explicit Bun-only deployment step with a single migration coordinator. Use backward-compatible expand/contract changes across the support window. Server restore, local index rebuild and normalization migration each carry version/checkpoint changes so old cursors cannot silently enter new semantics. Rebuilding derived indexes never discards primary prompt/outbox data.

Required validation includes the linked product scenarios plus:

1. Kill the process between local prompt and outbox writes, and before/after commit: either both survive or neither is acknowledged.
2. Accept an operation then lose its response; retry repeatedly, including after later edits/deletion: one effect, stable receipt, no stale projection overwrite.
3. Edit the same field differently on two devices; change different fields; edit while an earlier operation is in flight; preserve complete variants and later local edits.
4. Test text versus deletion in both arrival orders, metadata-only deletion conflicts, quota-blocked preservation and correction/discard paths.
5. Merge/delete organization while another device changes assignments, including alias chains, target deletion and blocked collection creation with dependent prompts.
6. Interrupt initial and replacement snapshots; expire a materialized snapshot; resume after more than ninety days; preserve pending work and selection/drafts.
7. Return after session expiry, revocation, account deletion, same-email recreation and server restore. Only matching verified deletion evidence wipes data; no cross-account/instance upload is possible.
8. Copy successfully then fail usage persistence; fail clipboard writing; replay a future-dated event after correction; ensure honest status and convergent Recents.
9. Verify all semantic search fixtures, complete pagination, Unicode scalar ordering, short/punctuation queries, title truncation, NUL rejection and equivalent online/offline snapshots.
10. Validate actual Windows reboot/logon, effective ACLs/second-user isolation, packaged Tauri command denial, renderer token non-exposure, origin/redirect restrictions and credential-error races.
11. Upgrade every supported schema with pending work; interrupt migrations; simulate full volume/I/O failures; refuse downgrade safely and test installed recovery.
12. Exercise real Google/GitHub and email flows, verified-email enforcement, password reset/revocation, browser-bound freshness and direct endpoint bypass attempts under actual Next.js/Bun/Tauri integration.
13. Rehearse deletion-safe restoration with the independently durable ledger unavailable, behind, and complete. Demonstrate the accepted recovery objectives and backup retention before opening service.
14. Run the exact supported-machine/browser/server capacity and latency workload, including 10,000 prompts/100 MiB, search including debounce/render, copy/save/startup, 120-second initial download, 1,000 edits/10 MiB within sixty seconds, sustained/burst server traffic and concurrent quotas. Record index/storage/memory costs and supported versions. Known failure blocks release.

The isolated research demonstrates selected primitives and specific negative findings; it does not replace these implementation-level gates. The accepted retrieval design replaces the measured failing scan plan and retains the 150 ms end-to-end target. Failure of an implementation gate requires correction before release, not silently weakening the specification.
