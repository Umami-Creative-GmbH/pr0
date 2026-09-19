# pr0 personal prompt library

The language of a personal library of reusable prompts, shared across a user's devices.

## Language

**Prompt**:
A reusable piece of text with a title, owned by a user and kept in their library. A prompt may also have a description, tags, and one collection.

**Library**:
The prompts and related organization belonging to one account, representing the same logical library across devices signed into that account.
_Avoid_: Workspace (while the product has only personal libraries).

**Instance**:
An independently operated pr0 service with its own accounts and libraries. The hosted service and each self-hosted service are separate instances.

**Account**:
A user's identity within one instance, owning one personal library. Using the same email on another instance does not make the accounts or libraries the same.

**Collection**:
An optional, named, flat grouping within a user's library. A prompt belongs to at most one collection; the collection is distinct from the prompts grouped under it.
_Avoid_: Folder (which may imply nesting).

**Tag**:
A lightweight label belonging to a user's library, used to organize prompts across collections. A prompt can have multiple tags; capitalization alone does not distinguish tags within a library.

**Favorite**:
A prompt the user has marked for convenient access. An archived prompt can retain this designation.

**Archived prompt**:
A retained prompt excluded from normal library views, available in the archive and eligible for restoration.
_Avoid_: Deleted prompt (deletion is permanent).

**Prompt copy**:
A separate prompt created by duplicating another prompt, with its own identity and history.
_Avoid_: Version (a copy is independent of its original).

**Tag merge**:
The combination of one tag and its prompt assignments into an existing tag in the same library.

**Conflict copy**:
A separate prompt preserving a competing edit that could not be reconciled with another edit or with deletion of the original prompt.
_Avoid_: Version (a conflict copy is an independent prompt, not an entry in visible version history).

**Quick launcher**:
The desktop entry point dedicated to finding a prompt and copying it to the clipboard.

**Prompt use**:
A successful copy of a prompt's content to the clipboard. Opening or editing a prompt is not a use.
_Avoid_: View (viewing a prompt does not indicate that it was used).

**Recents**:
The view of distinct active prompts that have been used, ordered by default by their most recent use across the account's devices. A prompt appears once regardless of how many times it has been used.
