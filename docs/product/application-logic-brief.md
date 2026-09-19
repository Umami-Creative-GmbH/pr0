# pr0 — Application Logic Brief

## Purpose

pr0 is a lightweight prompt library for storing, organizing, finding, and quickly copying reusable prompts.

The application should work as both:

* a desktop application for fast daily use
* a web application for access from other devices

Both should use the same user account and synchronized prompt library.

The core workflow is:

**Open pr0 → find prompt → copy prompt → continue working**

Everything should support that flow and avoid unnecessary complexity.

---

## Core Entities

### User

A user owns a personal prompt library.

Each user should only see their own prompts and related data unless shared functionality is introduced later.

A user account should allow the same prompt library to be accessed from multiple devices.

---

### Prompt

A prompt is the main entity in the application.

A prompt contains:

* title
* prompt content
* optional description
* tags
* optional collection
* favorite state
* creation date
* modification date

The application should also track enough information to support things like recent prompts and potentially usage statistics later.

Prompts can be:

* created
* viewed
* edited
* copied
* duplicated
* favorited
* archived
* deleted

Archiving should remove a prompt from the normal library without permanently deleting it.

---

### Collection

Collections provide simple high-level organization.

A prompt can optionally belong to a collection.

Examples:

* Development
* Writing
* Marketing
* Image Generation
* Research

Users should be able to:

* create collections
* rename collections
* delete collections
* assign prompts to collections
* move prompts between collections

Deleting a collection should not automatically delete its prompts.

Prompts can remain unassigned.

---

### Tags

Tags provide flexible organization across collections.

A prompt can have multiple tags.

Users should be able to filter prompts by tags.

Tags should remain lightweight and should not require a separate complicated management workflow.

---

## Main Library

The main application view represents the user's prompt library.

The library should support:

* all prompts
* favorites
* recent prompts
* collections
* tags
* archived prompts

Selecting any of these changes which prompts are displayed.

Selecting a prompt should make its full content and available actions accessible without requiring unnecessary navigation.

---

## Search

Search is one of the central application functions.

Search should find prompts based on:

* title
* prompt content
* description
* tags
* collection

Results should update immediately while the user types.

Search should work together with filters.

For example:

**Collection: Development + Tag: Code Review + Search: TypeScript**

The resulting list should only contain prompts matching those conditions.

---

## Copying Prompts

Copying is the primary action in the application.

A user should be able to copy a prompt directly from:

* the prompt list
* the prompt detail view
* search results
* the quick launcher

After copying, the application should give lightweight confirmation.

The application should also record that the prompt was used so that recent or frequently used prompts can be supported.

---

## Prompt Creation

Creating a prompt should require only:

* title
* prompt content

Everything else should be optional.

The user should be able to optionally add:

* description
* tags
* collection

The application should avoid forcing users to organize prompts before they can save them.

---

## Prompt Editing

Users can edit all editable prompt information.

Changes should automatically become available on other devices once synchronized.

Modification timestamps should update whenever meaningful prompt content or metadata changes.

---

## Favorites

A prompt can be marked as a favorite.

Favorites provide a quick way of accessing commonly used prompts.

Favoriting and unfavoriting should be possible from both the prompt list and prompt detail view.

---

## Recent Prompts

The application should maintain a list of recently used prompts.

A prompt should become recent when it is copied or otherwise explicitly used.

Recent prompts should make frequently used prompts quickly accessible without the user having to manually organize them.

---

## Duplicate Prompt

Users should be able to duplicate an existing prompt.

The duplicate should contain the same:

* content
* description
* tags
* collection

It should become a separate prompt with its own identity and modification history.

The title can initially indicate that it is a copy.

---

## Archive

Prompts can be archived instead of deleted.

Archived prompts:

* should disappear from the normal library
* should remain searchable from the archive
* can be restored

Archive should be useful for prompts that are no longer actively used but may still be needed later.

---

## Delete

Deleting a prompt should permanently remove it.

The application should distinguish clearly between:

* archive
* permanent deletion

Accidental permanent deletion should require confirmation.

---

## Synchronization

The desktop and web application represent the same underlying prompt library.

Changes made on one device should appear on other devices.

This includes:

* new prompts
* edits
* deletes
* favorites
* collections
* tags
* archive state

Synchronization should happen automatically.

The user should not normally need to think about synchronization.

---

## Offline Desktop Usage

The desktop application should remain useful if there is temporarily no network connection.

The user should still be able to:

* browse previously synchronized prompts
* search
* copy prompts
* create prompts
* edit prompts

Changes made while offline should synchronize once connectivity is restored.

If the same prompt is changed on multiple devices before synchronization, the application should avoid silently losing data.

The exact conflict handling can remain simple initially.

---

## Quick Launcher

The desktop application should support a fast prompt launcher separate from the full library interface.

The intended workflow is:

1. User opens the launcher using a global shortcut.
2. Search input is focused immediately.
3. User types part of the prompt title or content.
4. Matching prompts appear.
5. User selects a result.
6. The prompt is copied.
7. The launcher closes.

This should be one of the fastest ways to use pr0.

The launcher does not need the full management functionality of the main application.

It is primarily for:

**search → copy**

---

## Keyboard Navigation

The application should allow common operations without requiring the mouse.

Important interactions include:

* focus search
* navigate search results
* open a prompt
* copy selected prompt
* create a prompt
* close dialogs or launcher

Keyboard shortcuts should complement the interface rather than be required for basic usage.

---

## Prompt Variables

The application should be designed so prompts can eventually contain variables.

Example:

```text
Analyze {{website}} for {{topic}} and return the results as {{format}}.
```

Initially, these can simply behave like normal prompt text.

Later, pr0 may detect variables and ask the user to provide values before copying the final prompt.

The underlying prompt model should therefore not prevent this feature from being introduced later.

---

## Multi-Device Behavior

A typical user may use pr0 on:

* desktop workstation
* laptop
* another desktop
* web browser

All devices should display the same logical library.

The user should not have to manually import or export prompts between devices.

Signing into pr0 on a new device should restore the user's prompt library.

---

## Sorting

Prompt lists should support sensible sorting such as:

* recently used
* recently modified
* newest
* oldest
* alphabetical

A default sort should prioritize finding useful prompts quickly.

---

## Filtering

The user should be able to combine filters such as:

* collection
* tag
* favorite
* archived/not archived

Filters should also work together with search.

---

## Empty States

The application should handle empty states cleanly.

Examples:

### New user

The library is empty and the user is encouraged to create their first prompt.

### Empty collection

The collection exists but contains no prompts.

### No search results

Clearly indicate that nothing matched the current search or filters.

The application should never appear broken simply because no content exists.

---

## Future Team Support

The first version should primarily behave as a personal prompt library.

However, the application logic should leave room for future concepts such as:

* organizations
* shared prompts
* shared collections
* prompt ownership
* permissions
* team libraries

These features do not need to be implemented initially.

The personal library should remain the simplest and most important use case.

---

## Possible Future Prompt History

Prompt version history may be added later.

This could allow users to:

* see previous prompt versions
* compare changes
* restore an older version

Initial implementations do not need to expose version history, but prompt updates should not be designed in a way that makes adding it unnecessarily difficult.

---

## Main Application Areas

The application can conceptually be divided into:

### Library

Browse and manage prompts.

### Search

Quickly locate prompts across the entire library.

### Prompt Detail

Read a prompt and perform actions such as copy, edit, favorite, duplicate, archive, or delete.

### Prompt Editor

Create and modify prompts.

### Collections & Tags

Organize the library.

### Quick Launcher

Desktop-focused fast search and clipboard workflow.

### Account & Sync

Manage the user's identity and synchronization state.

---

## MVP Behavior

The first usable version should support:

* user accounts
* personal prompt library
* prompt creation
* prompt editing
* prompt deletion
* prompt archive and restore
* prompt duplication
* favorites
* collections
* tags
* full-text search
* filtering
* sorting
* recent prompts
* clipboard copying
* desktop quick launcher
* synchronization between desktop and web
* basic offline desktop access

The goal of the MVP is not to build an advanced prompt-management platform.

It should make storing and reusing prompts noticeably faster than keeping them in notes, documents, or text files.

---

## Core Product Rule

The most important application behavior is:

**The user should be able to go from needing a prompt to having it in the clipboard with as little interaction as possible.**

Management features should support this goal rather than compete with it.
