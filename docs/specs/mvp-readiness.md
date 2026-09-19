# MVP implementation-readiness handoff

Status: audit prepared for [issue #12](https://github.com/Umami-Creative-GmbH/pr0/issues/12) on 2026-09-19. The audit recommends accepting the specification as ready for implementation. Human confirmation is pending; this document does not close the readiness decision or certify a production release.

## Scope and authority

The [application logic brief](../product/application-logic-brief.md) is the requirements baseline. The [MVP map](https://github.com/Umami-Creative-GmbH/pr0/issues/1) records the accepted scope and decision history. The [domain glossary](../../CONTEXT.md) supplies the shared vocabulary; [architecture conventions](../architecture.md) preserve the Bun, Next.js REST, Tauri/Rust and shared-package boundaries.

This handoff indexes the canonical decisions and their acceptance examples. It introduces no product behavior, new domain terms, architecture decisions, build-task breakdown or production implementation. The audit inspected repository snapshot `e93614493aca8e135a136c4eb3bc93f845827d38`, the issue resolutions and live GitHub child/dependency relationships. All prerequisite decision tickets were closed; #12 remained open and was assigned to KaiSoellch for this decision.

Use the linked approved resolutions and specifications when implementing. Earlier research proposals and the throwaway prototype do not override them. Later explicit amendments below supersede only their stated subjects.

## Canonical specification index

| Area | Canonical decision and artifact |
| --- | --- |
| Prompt lifecycle and organization identity | [#4 approved rules and acceptance examples](https://github.com/Umami-Creative-GmbH/pr0/issues/4#issuecomment-5742392967) |
| Signup, identity, sessions, sign-out and new devices | [#5 approved account-access decision](https://github.com/Umami-Creative-GmbH/pr0/issues/5#issuecomment-5742474484) |
| Offline behavior and preservation | [#6 approved reconciliation decision](https://github.com/Umami-Creative-GmbH/pr0/issues/6#issuecomment-5742539348) |
| Search, filters, sorting, recency and empty states | [#7 approved retrieval decision](https://github.com/Umami-Creative-GmbH/pr0/issues/7#issuecomment-5742642457) |
| Capacity, responsiveness, support and release gates | [#8 approved operating envelope](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995), with its [storage-sizing follow-up](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5743821858) |
| Library and launcher interaction direction | [#9 human prototype acceptance and bounded evidence](https://github.com/Umami-Creative-GmbH/pr0/issues/9#issuecomment-5743990156) |
| Persistence, synchronization, security and shared API | [#10 approved architecture](https://github.com/Umami-Creative-GmbH/pr0/issues/10#issuecomment-5743817032); [persistence and synchronization contract](persistence-sync-contract.md), including the #21 amendment |
| Portable installation and self-hosting | [#11 approved operator-neutral deployment scope](https://github.com/Umami-Creative-GmbH/pr0/issues/11#issuecomment-5744296515); [deployment and self-hosting specification](deployment-self-hosting.md) |
| Save, synchronization and conflict presentation | [#18 approved presentation decision](https://github.com/Umami-Creative-GmbH/pr0/issues/18#issuecomment-5744406598); [presentation specification](save-sync-conflict-presentation.md) |
| Desktop lifetime, tray, startup and focus recovery | [#19 decision ticket](https://github.com/Umami-Creative-GmbH/pr0/issues/19); [approved desktop process model and human validation report](desktop-process-model.md) |
| Collection and tag management controls | [#20 approved management decision](https://github.com/Umami-Creative-GmbH/pr0/issues/20#issuecomment-5744544821); [management specification](collection-tag-management.md) |
| Typed variables and copying | [#21 approved resolution](https://github.com/Umami-Creative-GmbH/pr0/issues/21#issuecomment-5744639744); [canonical behavior and acceptance specification](variable-substitution-copy.md); [explicit persistence/shared API amendment](persistence-sync-contract.md#variable-substitution-amendment-issue-21) |

The approved specifications for #18–#21 complete the areas explicitly transferred out of #9. Closing the prototype ticket alone was not sufficient for readiness; those follow-up decisions are now settled. #19's approval and human validation are recorded in its linked repository document, rather than a resolution comment.

## Journey and requirements coverage

Each row identifies the governing acceptance material, rather than defining a second set of rules. Together these rows cover the brief's entities, application areas and complete MVP list, plus the map's social-login, self-hosting and variable-substitution refinements.

| Journey or requirement | Acceptance coverage and consistency check |
| --- | --- |
| Social signup, returning login and recovery | #5 covers verified identity, explicit provider linking and recovery. The contract's **Sessions and fresh authentication** section supplies browser-bound proofs and device-session restrictions; deployment specifies provider/email configuration and signup controls. No implicit same-email library merge is authorized. |
| New desktop/browser device | #5 and the contract's **Snapshots, cursors, notifications, and recovery** cover instance selection, browser-approved desktop access, partial initial download and completion. Personal ownership remains bound to immutable account and instance identities. |
| Create and view a prompt | #4 and #9 cover required title/content, optional description/tags/one collection, accessible list/detail actions and validation. #18 distinguishes an unsaved draft, a durable desktop save and server acceptance, including failure recovery. |
| Organize and move prompts | #4 defines flat collections, tag identity and assignment semantics. #20 supplies create/rename/delete/merge controls, counts, complete searchable pickers, cancellation and affected-prompt review. Deleting organization preserves active and archived prompts. |
| Find a prompt | #7 specifies all five searchable fields, literal matching, combined filters, deterministic relevance/sorts, scoped views and online/offline parity. The contract's **Search and pagination** supplies shared normalization, revision consistency and complete paging. Later matches remain reachable. |
| Copy from list, detail, search or launcher | #7/#9 define successful-copy feedback and use-based recency; the contract separates clipboard outcome from usage delivery. #21 covers exact template handling, typed values, cancellation, concurrency, clipboard failure/retry and transient retention. |
| Favorite, edit and duplicate | #4 covers direct favorite actions, meaningful modification times and independent prompt copies. #18 preserves drafts during incoming changes; the contract preserves subsequent local edits when earlier work becomes a conflict copy. Copying for the clipboard is distinct from duplicating a prompt. |
| Archive, restore and permanently delete | #4/#7 cover archive isolation, retained organization/favorite state, restoration, archive search and confirmed permanent deletion. The contract's **Reconciliation rules** cover text-versus-delete in both arrival orders and capacity-refused preservation. |
| Recents, sorts and untouched prompts | #7 owns copy-based, distinct-prompt recency and per-view sorting. The contract's [Usage and time validation](persistence-sync-contract.md#usage-and-time-validation) covers occurrence-time correction and idempotent delivery. Failed clipboard writes and mere viewing are not uses. |
| Quick launcher and keyboard use | #9 supplies search-to-copy interaction; #19 settles residency, close versus quit, single-instance activation, startup, shortcut collisions and focus recovery. #21 keeps value entry inside the launcher. #8 requires keyboard access, visible focus, accessible dialogs/errors and manual screen-reader checks. |
| Empty library, empty collection and no results | #7/#9 distinguish first-prompt creation, an existing empty collection and no matches under the current search/filters. #20 additionally covers unused organization and unavailable filters without silently changing their meaning. |
| Offline work, reconnect and conflicts | #6, the contract's transaction/protocol traces, and #18 cover offline mutations, durable pending work, retries, interrupted/expired snapshots, preserved variants, rejected work and visible recovery. Browser drafts retain the separately bounded open-tab guarantee. |
| Sign-out, account/instance switching and deletion | #5 and the contract's **REST and native boundaries** and **Account deletion and restoration safety** cover pending-work choices, native authority, stale responses, separate partitions and verified deletion evidence. #21 clears transient values on transitions. Generic authentication failures cannot authorize local deletion. |
| Install and maintain a self-hosted instance | #11 specifies portable Compose, initialization/migrations, persistent identity/data, HTTPS, SMTP, optional OAuth, registration admission, backups, deletion-safe restore, upgrades and compatibility. Operators supply hosting integrations; official desktop update trust stays independent of the selected instance. |
| Release support and performance | #8 and #19 define supported environments, reproducible workload/timing/resource checks and accessibility. The contract and deployment specification retain interrupted-sync, upgrade-with-pending-work, isolation and restore gates. These are required future evidence, not newly unowned decisions. |
| Future teams and visible prompt history | The map expressly defers team/shared-library permissions, visible version history and advanced analytics. Independent identities, revision/baseline data and conflict preservation serve the current personal-library scope without promising those future features. |

## Reconciled amendments and apparent contradictions

- **Variables:** the brief's initial allowance for literal variable-like text and the early #9 comment's exclusion are superseded by the current map and approved #21. Implement the [variable specification](variable-substitution-copy.md) together with the [contract amendment](persistence-sync-contract.md#variable-substitution-amendment-issue-21). Values and substituted output are transient; saved template content and existing usage operations remain authoritative. No value persistence, synchronization or new mutation kind is implied.
- **Prototype limits:** #9's resolution explicitly rejects treating its seven visible rows as a total-result cap. #20 replaces prototype chip lists with complete searchable pickers. Prototype normalization, state storage and decorative synchronization feedback are not production contracts.
- **Storage sizing:** #8's follow-up points to #10's revised 64-GiB full-workload validation allocation. Earlier 40/128-GiB proposals are not competing requirements. #11 makes this a benchmark fixture, not a minimum installation or server-purchase requirement.
- **Hosting choices:** #11's approved clarification supersedes requests to select a particular host, vendor, domain or named operations team during specification work. It retains the application configuration, abuse, recovery, deletion-evidence and release guarantees. No hosting-selection ticket is needed.
- **Deployment integration:** #11's resolution accurately described its branch as unmerged at publication. Commit `b5a3a9dabbec761df7690293490d0f2684dd6557` is an ancestor of the audited snapshot, which contains the deployment specification and Compose assets. That historical integration note is no longer outstanding work for this handoff.
- **Desktop memory:** #19 explicitly places the contract's application-cache allowance inside the overall resident-process budget; it is not an additional allocation. Its documented human validation report does not establish unrecorded build, platform or timing evidence.
- **Organization identity versus filters:** merge aliases reconcile pending assignments under #10. #20 separately requires an explicit choice before replacing an unavailable selected filter. Data reconciliation does not authorize a silent UI filter change.

No unresolved contradiction, unowned in-scope requirement or implementation-blocking product/architecture choice was identified in this audit. No decision ticket needs reopening or creation on the evidence inspected. This is an audit conclusion for human review, not an inference from ticket closure alone.

## Evidence and release boundary

The research linked from the [persistence contract](persistence-sync-contract.md#components-and-ownership) supports selected authentication, native persistence/credential and search primitives. #9 records acceptance of the available prototype; #19 records the user's validation report with its evidence limits. #11 records an AMD64 starter-container run; ARM64 application execution remains unverified. None of those records certifies the complete MVP.

Implementation must still produce and pass the canonical acceptance cases. In particular, preserve these release gates through handoff:

- The [operating envelope](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995) and [desktop installed matrix](desktop-process-model.md#observable-acceptance-examples-and-installed-release-matrix): supported Windows 11 x64/WebView2 and current/previous major desktop browsers, keyboard/screen-reader checks, maximum-library latency, server load and resident-resource measurements.
- The [contract's fourteen validation groups](persistence-sync-contract.md#compatibility-and-release-validation): real authentication/native integration, account isolation, atomic saves, uncertain-delivery replay, concurrent edits/deletion, quota preservation, interrupted snapshots, long absence, migrations and upgrades with pending work.
- [Deployment and recovery acceptance](deployment-self-hosting.md#acceptance-and-remaining-implementation): working full-feature self-host instructions, compatibility negotiation, signed official installation/updates, backup retention and deletion-safe restore meeting the agreed objectives. Selecting a vendor remains an operator task; meeting application guarantees remains required.
- [Variable conformance and interaction cases](variable-substitution-copy.md#settled-acceptance-examples): identical web/native parsing and validation, bounded exact output, transient-value isolation, common clipboard guarding and usage-only retries.

Known data loss, isolation failures, broken core keyboard paths, failed restore/update tests or failed accepted performance workloads block release. Specification approval does not waive any of these gates. Current repository typechecks/tests verify the existing foundation and prototype only; they do not validate these future production behaviors.

## Readiness decision awaiting the human

Recommendation: accept this linked specification set as implementation-ready for the full agreed Windows-first MVP, with production implementation and release validation following separately.

The remaining decision is the explicit human confirmation required by #12. Once confirmed, record the answer and a committed handoff link in the issue resolution, close #12 and add its named context link to the parent map. Until then, keep #12 open and do not present readiness as approved.
