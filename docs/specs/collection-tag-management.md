# Collection and tag management

Status: approved interaction specification for [issue #20](https://github.com/Umami-Creative-GmbH/pr0/issues/20). The user accepted all nine recommendations in two live decision rounds and approved this consolidated specification on 2026-09-19. This document records the agreed behavior; it does not claim an implemented or runtime-tested management interface.

## Authority and scope

- The [canonical lifecycle decision](https://github.com/Umami-Creative-GmbH/pr0/issues/4#issuecomment-5742392967) owns flat collections, organization identity, rename-everywhere, explicit tag merge, assignment changes and deletion that preserves prompts, including archived prompts.
- The [retrieval decision](https://github.com/Umami-Creative-GmbH/pr0/issues/7#issuecomment-5742642457) owns AND filters, collection identity, archive isolation, view navigation and prompt selection. This document specifies controls and visible responses without changing those rules.
- The [capacity decision](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995) owns numeric limits, warnings and responsiveness requirements. Management and filtering must remain usable with 200 collections, 1,000 tags and 10,000 prompts including the archive.
- The [persistence and synchronization contract](persistence-sync-contract.md) owns canonical Unicode identity, validation, atomic organization operations, merge aliases, reconciliation and durability. The [save and synchronization presentation specification](save-sync-conflict-presentation.md) owns saved/pending/error wording and recovery.

Use the existing glossary's Collection, Tag, Tag merge, Prompt, Library and Archived prompt terms. No new domain term or architecture decision is needed. The existing prototype lacks management actions; this specification does not make its in-memory behavior production-ready.

## Entry points and the sidebar

Provide one **Manage collections and tags** dialog with **Collections** and **Tags** tabs in the web and desktop libraries. A visible **Manage** action beside each sidebar section heading opens the corresponding tab. Accessible names distinguish **Manage collections** from **Manage tags**.

Opening or closing management preserves the underlying view, text query, filters, sort and selected prompt, subject to ordinary live eligibility changes. Clicking a collection or tag filter continues to filter; it never opens editing or deletion. Management operates on the whole personal library, independently of the background result set.

This adds one management entry beside each section heading and one deliberate step before editing. It keeps rename/delete controls out of ordinary filter selection. The quick launcher has retrieval controls only; it has no management entry or management actions.

Replace the prototype's full chip lists with searchable collection and tag pickers at every library size. Show chips only for selected conditions. Collection selection retains the existing single-collection behavior; multiple selected tags combine with AND, together with the view, query and favorite condition. Collection selection uses identity, not a text match of its label.

Both pickers expose all entries, including unused ones, with usage counts. Clearly label counts as library-wide, including the archive; they are not promises of matches in the current view. Selecting a tag used only in the archive can correctly produce no active results. The launcher's results still exclude archived prompts and its query/filters still reset on every opening.

Keep picker results and selected conditions in bounded, scrollable regions rather than allowing them to displace the prompt list indefinitely. Every selected condition remains discoverable and individually removable. Scrolling or pagination must expose the complete matching set, without an arbitrary total display cutoff. Search and accessible navigation replace visual scanning well before the capacity limit is reached; no small-library chip mode or threshold transition is required.

## Management lists and creation

Each tab provides **Create**, name search, an alphabetical list and an **Unused** filter. Each row shows the name, total assigned prompt count, active count and archived count, with reachable **Rename** and **Delete** actions. A prompt contributes once to an individual object's count. Unused means zero active and zero archived assignments. Empty collections and unused tags remain until explicitly deleted.

Name search narrows the management list only. Use the canonical search normalization/comparison rules without turning search equivalence into organization identity. The manager and pickers must not substitute the prototype's lowercase/slug shortcuts for the contract's Unicode identity rules.

Create and Rename use an explicitly labelled name field and submission action. Trim surrounding whitespace, preserve internal spacing, reject blank names, and apply the existing 60-Unicode-code-point name limit and malformed-input validation. Preserve entered text on validation errors. Collections remain flat; no parent field is offered. Equivalent tag creation resolves to the existing tag under the contract and identifies that result to the user; it does not create a duplicate or imply that prompts have been assigned to it. A new unused object is visible immediately after the appropriate durable save succeeds.

Show the existing warnings at 90% of quota: 180 collections or 900 tags for the count limits. Enforce the maximum of 200 collections and 1,000 tags, as well as the shared text quota. A refused addition identifies the actual limit and retains the name for correction. Browsing and cleanup remain available at capacity; allow deletions and usage-reducing changes under the canonical quota rules. Archiving frees neither organization slots nor prompt capacity.

Bulk selection/cleanup and collection merging are outside this MVP. Deleting or merging one organization object can affect many prompt assignments; that remains a single deliberate action, not a bulk-selection interface.

## Renaming and explicit tag merge

An ordinary rename uses **Save** and updates the object's label wherever referenced, including archived prompts and selected filters. Preserve identity and the lifecycle rule that renaming the referenced object does not change each prompt's modification date. A capitalization-only change of the same object is a rename, not a collision with a different object.

A collection rename that collides with another collection shows a field error and preserves the entered name. Do not offer collection merge, choose a different collection identity automatically, or silently alter prompt assignments.

A tag rename that collides with a different existing tag replaces the ordinary save outcome with an explicit confirmation:

> Merge “Draft” into “Writing”?
>
> Writing will remain. Prompts using Draft will use Writing. Prompts already using both will have Writing once. Your prompts will be kept.

Show active and archived source-assignment counts and the distinct resulting target counts. Count prompts shared by both tags once in the resulting total. The confirmation action is **Merge into Writing** and the alternative is **Cancel**. Keep the existing target's identity and display capitalization. Declining or cancelling leaves names and assignments unchanged. An ordinary Save action is never sufficient approval for a newly discovered collision.

If the merge source is an active filter, explain in the confirmation that it will become unavailable and will offer **Use Writing instead**. Do not silently retarget that filter. Merge identity aliases used for pending assignment reconciliation remain governed by the persistence contract; they do not authorize a UI filter substitution.

## Deletion and reviewing its effects

Confirm each collection or tag deletion, including unused objects. Show the object name, active count, archived count and a specifically named **Delete collection** or **Delete tag** action, alongside **Cancel**.

For a collection, say **These prompts will become unassigned. Your prompts will be kept.** For a tag, say **This tag will be removed from these prompts. Your prompts will be kept.** Explain when a selected filter or collection view will become unavailable. Cancelling changes nothing. Neither operation offers deletion of the associated prompts.

After the required durable save succeeds, keep a result message in the manager with the affected active and archived counts. For example: **Collection “Work” deleted. 3 active prompts and 2 archived prompts are now unassigned.** Tag deletion similarly confirms that assignments were removed and prompts were kept. Include the appropriate local/server save status; a desktop local result is not a claim of synchronization.

Provide **Review affected prompts** from that result. It shows the affected prompt identities grouped into active and archived, independently of the background query or filters. Expose the affected list through scrolling or pagination without truncating its logical membership. The collection-deletion review shows that the affected prompts are unassigned; tag-deletion review shows the removed tag in the operation summary. Prompts retain their other metadata under the lifecycle rules.

This is an operation review within the manager, not a new persistent library view or an Unassigned retrieval filter. Keep its original affected identities rather than re-running a broad query for every currently unassigned prompt. If a prompt subsequently changes or is deleted, reflect its current state without attributing the later change to this operation or recreating it. The result describes the operation's observed effects, not a frozen copy of the prompt. It does not promise an audit history after the management session or an Undo action.

## Active filters and collection views

| Change | Required response |
| --- | --- |
| Rename a selected collection or tag | Update the visible name and retain the selected identity. Normal text-query eligibility still recomputes against the renamed label. |
| Delete a selected optional filter | Keep its condition visibly marked **Deleted** and return no matches until the user explicitly removes it. Keep the other conditions and the current view. |
| Delete the collection defining the current view | Keep a visible unavailable collection state and offer **Go to All prompts**. Only that explicit navigation performs the existing view-navigation query/filter reset. |
| Merge a selected source tag into another tag | Keep an unavailable source condition, explain **Merged into Writing**, and offer **Use Writing instead** or explicit removal. Substitution changes only that condition and deduplicates the target if already selected; all remaining conditions still combine with AND. |
| Rename, delete or merge organization on another device | Apply the same visible identity/filter rules after reconciliation, without a focus-stealing dialog or silent broadening. |

If the merge target has itself been merged or deleted, use the canonical current identity information to explain the state. Offer substitution only to an existing resolved target, name that target explicitly, and require the user's action. Never offer a broken target or silently follow an alias as a filter change.

No unavailable condition falls back to textual matching or an identically named replacement. Preserve the existing no-match explanations and explicit clearing actions. Prompt selection continues to follow identity while eligible; when nothing qualifies, nothing is selected or copyable.

## Saving, concurrency and accessibility

Desktop management can save offline after initial library setup. Report **Saved on this device · Changes waiting to sync** only after the organization change and pending work are durably committed. Web success waits for server acknowledgement. While saving, make the pending state visible and prevent accidental duplicate submission. Failures retain entered names and the relevant recovery actions; closing a panel must not silently discard unsaved or pending work.

Counts describe the currently available library snapshot. Make offline, incomplete-download and pending-change status visible through the existing status presentation. Counts in a confirmation are not a lock on another device's work or a promise about unseen future assignments. Refresh known changes before submission and present any newly required decision rather than claiming an obsolete result is authoritative.

If synchronization discovers a tag-name collision, retain the pending rename and expose **Changes need attention** with the explicit merge choice. Never infer approval from the earlier rename. A collection collision offers correction of the name. Deletion wins over stale assignments or renames under the canonical contract; keep the prompts and explain organization adjustments. Local failure says **Not saved**, and a rejected upload is not successful synchronization.

All core actions, tabs, search fields, picker options, row actions, confirmation controls, selected filters and affected-prompt review must work by keyboard with visible focus and accessible names. Announce meaningful errors and results without repeated background chatter. Confine focus appropriately to the dialog, preserve drafts under the existing discard rules, and restore focus to the invoking control when closing. Usable zoom and long names must not hide action controls or selected conditions. Meet the existing accessibility target; no completed screen-reader or platform validation is claimed here.

## Observable acceptance examples

These are required future user-visible behaviors, not new automated tests against the throwaway prototype.

1. **Rename:** Tag Draft is assigned to two active prompts and one archived prompt and is selected as a filter. In Manage tags, rename it to Ready and Save. Every reference displays Ready, including the selected filter and archived prompt; the tag identity is retained and prompt modification dates do not change solely because of the rename. Changing Ready to READY is also a rename. A collection rename to another collection's equivalent name instead fails visibly with its input retained.
2. **Colliding rename and merge:** Draft belongs to active prompts A and B and archived prompt C. Writing belongs to B and active prompt D. Renaming Draft to `writing` offers **Merge into Writing**, identifies the source's 2 active/1 archived assignments and the resulting 3 active/1 archived distinct prompts, and explains that Writing survives. Cancel changes nothing. Confirm keeps A, B, C and D, leaves B with one Writing assignment, and removes Draft as a separate tag. A selected Draft condition becomes visibly unavailable; only **Use Writing instead** substitutes the target. If Writing was already selected, it appears once afterwards and other AND conditions remain.
3. **Delete a populated collection:** Work contains 3 active and 2 archived prompts. Delete collection confirms all five, says they will become unassigned and will be kept, and permits cancellation. On successful saving, Work is removed while all five prompts remain with no collection. The manager retains the result counts and **Review affected prompts**, separated into active/archive. An active Work filter stays marked Deleted with no matches until removed; a Work view offers explicit navigation to All prompts. Restoring either archived prompt later does not restore Work.
4. **Delete a tag:** German belongs to 2 active and 1 archived prompt. Delete tag identifies all three assignments and states that prompts will be kept. Cancel preserves everything. Confirm removes German and those assignments, preserves the prompts and their other tags/collections, and leaves a result with counts and affected-prompt review. No prompt editor needs to be opened to remove the tag everywhere.
5. **Discover unused objects:** An unused tag appears with total 0 and is returned by Unused. A tag assigned to one archived prompt shows active 0, archived 1 and is absent from Unused. Removing its last assignment makes it unused but does not delete it. Empty collections follow the same discovery rule.
6. **Full supported capacity:** With 200 collections and 1,000 tags, name search and keyboard navigation can reach any entry in management and filtering. Only selected filter conditions occupy the selected-chip region; every selected condition remains removable. No pagination or display threshold hides later matches. Creation at a known limit identifies the quota while cleanup stays available; 180 collections or 900 tags triggers the corresponding warning. Validate existing responsiveness targets at the maximum supported library size, including organization operations with many assignments.
7. **Independent management:** From Favorites with a query and two tag filters, open Manage tags, search its list, inspect an unused tag and close. The original library query, filters, view and sort remain. Actual mutations still update normal result eligibility and selection; opening the manager alone does not clear them.
8. **Offline or failed save:** An offline desktop rename succeeds locally and is labelled saved on this device/pending sync. A failed local commit leaves the name available with Not saved. A failed web request does not claim local durability. Reconnecting into a collision retains the work and asks for explicit merge approval or collection-name correction.
9. **Remote removal and later changes:** A selected tag is deleted on another device. After reconciliation, keep the Deleted condition and no-match state rather than exposing broader results. If an affected prompt is subsequently reassigned while its deletion review is open, show its current assignment without changing the original operation's affected membership or claiming it is still unassigned.
10. **Keyboard and archive isolation:** Open management, switch tabs, search, rename, cancel a deletion, inspect affected active/archive groups, and close using the keyboard. Focus returns to the invoking control. The manager's archive counts/review do not insert archived prompts into ordinary library results or the quick launcher.

## Completion boundary

All interaction decisions within #20 are settled by the two accepted rounds and final approval of this consolidated specification. Production UI, shared operations, persistence and runtime acceptance testing remain implementation work. No source behavior, glossary definition, lifecycle rule or retrieval predicate is changed by this document.
