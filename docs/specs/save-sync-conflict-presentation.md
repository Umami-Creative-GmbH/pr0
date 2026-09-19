# Visible save, synchronization, and conflict states

Status: presentation specification for [issue #18](https://github.com/Umami-Creative-GmbH/pr0/issues/18), accepted by the user in two live decision rounds on 2026-09-19. The user accepted all nine recommendations and confirmed the shared specification. The acceptance examples below describe required future behavior; they are not evidence of implemented or runtime-tested synchronization.

## Authority and scope

The [canonical offline and conflict decision](https://github.com/Umami-Creative-GmbH/pr0/issues/6#issuecomment-5742539348) owns reconciliation, conflict-copy creation, preservation and retention. The [persistence and synchronization contract](persistence-sync-contract.md) supplies the mechanisms and accepted refinements, including deletion conflicts in either arrival order, retained full titles and refused preservation. This document defines their presentation without changing those guarantees.

Retain the compact library/list/detail/editor and quick-launcher direction accepted in [issue #9](https://github.com/Umami-Creative-GmbH/pr0/issues/9#issuecomment-5743990156). The existing prototype's synchronization badge is decoration; this decision does not make it functional. No additional prototype was needed to settle these wording and interaction choices. There is no claim of a human walkthrough of new screens.

Use the existing glossary's Prompt, Library, Account, Instance, Conflict copy and Quick launcher terms. No new domain term or architecture decision is introduced. Desktop process lifetime, tray/startup, collection/tag management screens and variable substitution remain with their existing tickets.

## Quiet default and presentation surfaces

- Replace the decorative status badge with one compact status control in the existing library header. Opening it reveals synchronization details and recovery actions. Keep routine status out of prompt rows; affected prompts receive an indicator when their work needs attention.
- Place immediate save feedback beside the editor's Save action. After a successful save closes the editor, keep the saved prompt's status available in its detail view so closing does not hide whether work is local or server-acknowledged.
- Expose a persistent **Conflicts to review** entry while unreviewed conflicts exist. It opens a review surface pairing each conflict copy with its original where available.
- Give the quick launcher a small, nonblocking status and a link to library details. Background synchronization never takes focus, opens a modal, prevents copying available prompts or changes the launcher's successful-copy/failure behavior.
- Do not show routine save/synchronization success toasts or repeated alerts for an unchanged problem. Status and recovery controls must work with keyboard and assistive technology, and convey their meaning in text rather than color alone. Background changes do not move focus or announce a continual status feed.

## Saving and editor behavior

Keep explicit Save. Distinguish the current draft, the latest locally durable edit and the latest server-acknowledged edit; an older successful save cannot certify a newer draft.

| State | Visible presentation | Editor and recovery behavior |
| --- | --- | --- |
| Draft differs from its saved state | Unsaved changes | Preserve the draft until saved or deliberately discarded. |
| Save is in progress | Saving… | Keep the editor open while the required save result is unknown. |
| Desktop local commit succeeds | Saved on this device; Changes waiting to sync | Close the editor after durable local saving. Server connectivity is not required. |
| Server acknowledges that edit | Saved to server | This certifies server acceptance, not delivery to every other device or completion of unrelated work. |
| Local persistence fails | Not saved | Keep the editor and text available. Explain the failure and offer Retry and Copy text. Do not promise survival after restart. |
| Web save fails or connectivity drops | Not saved | Keep the draft in the open tab with Retry and Copy text. Do not promise recovery after closing/reloading the tab or restarting the browser. |

Web closes the editor only after server acknowledgement. It never uses **Saved on this device** to imply the desktop's durability guarantee. Desktop's local durability covers ordinary app/Windows restarts, not disk loss.

Incoming updates never replace an open unsaved draft. If reconciliation maps an edited variant to a conflict copy, follow the contract's identity mapping and show **You're editing the conflict copy**, linking to the original when it still exists. Preserve subsequent edits; do not imply that the draft is saved merely because the earlier variant reached the server.

Successful Copy text recovery uses the normal clipboard result feedback. A failed clipboard write remains an error and does not falsely report success or clear the retained text.

## Ambient synchronization and freshness

The header reports the most actionable condition while keeping pending work visible. Details retain all coexisting conditions rather than replacing one with another.

| Condition | Compact wording | Details |
| --- | --- | --- |
| Offline with queued work | Offline · Changes waiting to sync | Explain that durably saved desktop work remains on this device and will retry when connectivity returns. |
| Authentication is required | Sign in to sync · Changes waiting | Offer sign-in for the same account on the same instance; preserve local access and pending work. Omit the pending phrase only when no work is pending. |
| Temporary synchronization failure | Couldn't sync · Changes waiting | Explain automatic retry and offer retry when appropriate, without interrupting ordinary use. |
| Rejected or preservation-blocked work | Changes need attention · Changes waiting | Link to the affected work, reasons and recovery actions. Keep offline/authentication/download conditions visible in details. |
| Download or reconciliation in progress | Updating this device's library… | Keep Changes waiting visible when local work remains; show measurable download progress in details. |
| No pending work or current blocker | Up to date at last check | This describes this device's completed server check, not a guarantee that every other device has uploaded its work. |

Offline without pending work still says **Offline**. A completed upload is distinct from a completed download/check. An accepted edit awaiting canonical records may say **Saved to server** while the library still says it is updating. Never show an all-clear while rejected work, pending preservation or other synchronization work remains unresolved.

Details show **Last checked for updates 2 hours ago**, with an exact timestamp available. Measure from the last completed server check whose updates have been applied, not a local save, connection attempt or partial download. Before any completed check, say **Not yet checked for updates**. The age is an approximate indication of this device's freshness; it is not the age of every prompt or proof of global synchronization.

An already preserved and synchronized conflict copy awaiting human review is distinct from failed preservation: it retains **Conflicts to review** without pretending that transfer is still pending. Acknowledging a notice does not resolve an independent blocked upload.

## Rejected work and capacity

Provide a persistent **Changes need attention** entry in the status control and an indicator on affected prompts. Details identify each affected item, explain what could not happen, and distinguish work saved locally from an unsaved draft. For work without a visible prompt, such as a pending deletion or rejected collection creation, keep an entry in details so it remains discoverable.

Offer actions appropriate to the actual problem:

- Rename a conflicting collection or correct invalid content; retain dependent work while it waits. Tag merge still requires its existing explicit choice.
- Retry a retryable failure; sign in for authentication; update the client or explain instance compatibility when versions cannot communicate.
- For capacity refusal, state the actual limiting resource and available usage information. Retain the accepted capacity warning at 90%. Explain that archiving frees no capacity; deletion or usage-reducing edits may help when permitted by the contract. Do not suggest deleting content to fix an unrelated server storage outage.
- Keep retained text accessible for copying. Offer explicit **Discard pending changes** with a confirmation explaining which local work would be lost. Discard is not an undo of an effect already accepted by the server; resolve uncertain delivery under the existing receipt rules before presenting its outcome as known.

Unrelated changes continue synchronizing. A mixed outcome must not appear wholly synchronized. When a required conflict copy cannot reach the server, explain that the competing text is retained locally and still needs attention; do not claim the independent copy is server-saved. If a stale deletion cannot preserve an unseen edit, explain that deletion remains pending and the server's original was not deleted.

Desktop retained pending work and its actionable status remain discoverable after ordinary restarts. Web refusal retains only the open-tab draft under the browser guarantee. Dismissing a panel does not discard work or clear its unresolved status.

## Conflict review and organization adjustments

Conflict copies retain the canonical title **Original title (conflict copy)**, active state, fresh dates, no usage history and no favorite designation. Preserve text and valid organization. If the generated title must be shortened under the contract, expose the full retained source title in conflict details; acknowledgement does not remove it.

Do not override normal library sorting, filtering, search eligibility or launcher ordering to place a copy next to its original. Pair them in the dedicated review surface instead. That surface lists unreviewed conflict pairs newest first and labels the original and conflict copy distinctly. It explains why both exist without presenting either as a recommended winner.

Offer **Open original**, **Open conflict copy**, and **Keep both / Mark reviewed**. When the original has been deleted, identify it as deleted and omit its unavailable open action; **Mark reviewed** keeps the surviving copy. When an original is archived, identify that state and let its review link open the archived prompt without adding it to ordinary active results. Editing and deletion use normal lifecycle controls and confirmations; this is not a version-history interface or automatic text-merge tool.

A review acknowledgement clears the review notice only. It neither deletes a copy nor alters its retained text. If ignored indefinitely, the notice remains available and the independent copy follows ordinary prompt retention and lifecycle rules, without an expiry or escalating reminders. Confirmed account deletion remains governed by the account policy.

Show superseded organization choices and removed invalid references in the same details area with plain explanations, for example: **Collection was deleted on another device; your prompt was kept.** Keep these notices until acknowledged, without repeated alerts. An organization adjustment is not a text conflict and does not manufacture a conflict copy.

## Long absence and reconnect

On a large reconciliation, show **Updating this device's library…** and explain that saved local work is retained while this device catches up. Keep pending work visible alongside progress. Keep the existing library usable during a replacement download, preserve selection by identity while eligible, and keep open drafts intact. Show numeric progress only for a measurable stage; downloading all snapshot pages is not itself proof that reconciliation and uploads are finished.

An initial partial download may expose available prompts but must explicitly say that the library is still downloading and results are incomplete. Cancellation, interrupted downloads, snapshot expiry or insufficient scratch space must not turn retained work into an empty library or a success message. Show the actionable error and retry path supplied by the contract.

Finish quietly when reconciliation needs no attention. Otherwise present one nonblocking summary linking to conflict pairs, rejected changes and organization adjustments, rather than one alert per operation. If login or an update is needed first, show that action with pending work still visible. Generic authentication failure is not evidence of account deletion; only the existing verified deletion flow authorizes clearing that account's local data.

## Interruptions

A failed save immediately produces a persistent inline error at the action the user took. Background offline status, expired authentication, failed uploads and arriving conflicts produce persistent nonblocking information, never focus-stealing modals. Use confirmations for deliberate actions that would discard unsaved or pending work and retain existing destructive-action confirmations. A background error alone never prevents copying an available prompt.

## Observable acceptance examples

These are presentation acceptance scenarios for future implementation, not automated tests added to the throwaway prototype.

| Scenario | Required observable result |
| --- | --- |
| **Failed desktop save:** The user changes content and Save encounters a full disk. | The editor stays open with the complete draft, Not saved, an explanation, Retry and Copy text. Neither the prompt nor header claims that this draft is durable. Copy failure leaves the text available. |
| **Offline save:** A desktop save commits while offline, then the app and Windows restart normally. | The editor initially closes only after commit. Saved on this device and Offline · Changes waiting to sync describe the saved work; after restart the work and pending status remain. No success toast is required. |
| **Web outage:** A browser save loses connectivity. | The editor stays open with Not saved and Retry/Copy text. Wording makes the open-tab limitation clear and does not claim desktop-style restart recovery. |
| **Arriving conflict copy:** A's content is accepted first; B's competing content later creates a copy while the user is copying another prompt. | Copying proceeds with no modal or focus change. Conflicts to review persists; its newest-first review surface pairs the labelled original and copy. Ordinary library/search order is unchanged. |
| **Ignored or acknowledged conflict:** The user leaves a conflict unreviewed, then later selects Keep both / Mark reviewed. | Before acknowledgement, the notice and copy remain indefinitely under normal lifecycle rules. Afterwards the notice clears while both prompts and retained full title remain. No pending upload is silently dismissed. |
| **Deleted original:** An offline text edit is preserved after another device deletes its original. | Review explains the original was deleted, offers the independent conflict copy and Mark reviewed, and never recreates the original or offers a broken Open original action. |
| **Refused write:** A collection name collision blocks its dependent prompt while an unrelated favorite change succeeds. | Changes need attention identifies the collection and dependent work, offers Rename and retains the local work. The favorite may synchronize, but the header still shows pending work. |
| **Capacity-refused preservation:** A competing text variant cannot be stored on the server. | Retain the variant locally, show an actionable capacity explanation and copy access, and never report full synchronization. Archiving is not offered as capacity recovery. The server-saved claim is absent for the refused variant. |
| **Refused deletion:** A stale deletion needs to preserve an unseen server edit, but that preservation is refused. | Explain that deletion remains pending and the server original remains unchanged. Do not falsely report successful deletion or ask the user to resolve a copy that was never stored. |
| **Long absence:** A device returns after months with pending edits and needs a replacement download. | Updating this device's library… explains retained local work. Existing prompts stay usable; pending work, selection and drafts survive staging. At completion, one summary links to any conflicts, refusals and adjustments; a clean completion stays quiet. |
| **Partial download or interruption:** Initial download is incomplete, or a replacement download fails. | Initial results are labelled incomplete. A failed replacement retains the previous usable library and pending work with retry; neither case is Up to date at last check for the unfinished check. |
| **Freshness and mixed states:** A local edit is saved now, the last completed server check was two hours ago, and sign-in is required. | Show Sign in to sync · Changes waiting and Last checked for updates 2 hours ago. The local save does not reset the freshness timestamp or imply delivery to another device. |
| **Draft during reconciliation:** An incoming update arrives while a draft is open, or an earlier saved variant becomes a conflict copy. | Preserve the unsaved draft. If its editing identity is redirected, show You're editing the conflict copy and the available original link; a server acknowledgement for the earlier edit does not certify the draft. |
| **Organization adjustment:** Another device deletes a collection while local assignment work waits. | Keep the prompt, explain removal of the invalid assignment in details, and retain the notice until acknowledged. Do not create a text conflict copy solely for the organization change. |

## Completion and implementation boundary

All presentation decisions within #18 are settled by the two accepted rounds. Production UI, persistence, synchronization and runtime acceptance testing remain implementation work. Preserve the distinction between this approved specification and the existing in-memory prototype; its save/synchronization behavior does not yet satisfy these scenarios.
