# pr0 personal prompt library

The language of a personal library of reusable prompts, shared across a user's devices.

## Language

**Prompt**:
A reusable piece of text with a title, owned by a user and kept in their library. A prompt may also have a description, tags, and one collection.

**Library**:
The prompts and related organization belonging to one user, representing the same logical library across that user's devices.
_Avoid_: Workspace (while the product has only personal libraries).

**Collection**:
An optional, named grouping within a user's library. A prompt belongs to at most one collection; the collection is distinct from the prompts grouped under it.
_Avoid_: Folder (which may imply nesting).

**Tag**:
A lightweight label used to organize prompts across collections. A prompt can have multiple tags.

**Favorite**:
A prompt the user has marked for convenient access.

**Archived prompt**:
A retained prompt excluded from the normal library view, available in the archive and eligible for restoration.
_Avoid_: Deleted prompt (deletion is permanent).

**Quick launcher**:
The desktop entry point dedicated to finding a prompt and copying it to the clipboard.
