/**
 * PROTOTYPE (issue #9) — prompt lifecycle rules agreed in issue #4, plus the
 * "a use is a successful copy" rule from issue #7.
 *
 * Every function returns a new Library; nothing is persisted.
 */

import type { CollectionId, Library, Prompt, PromptId, TagId } from "./types";

export interface PromptDraft {
  title: string;
  description: string;
  content: string;
  collectionId: CollectionId | null;
  tagIds: TagId[];
}

export interface DraftErrors {
  title?: "blank";
  content?: "blank";
}

const mapPrompt = (
  library: Library,
  id: PromptId,
  update: (prompt: Prompt) => Prompt
): Library => ({
  ...library,
  prompts: library.prompts.map((prompt) =>
    prompt.id === id ? update(prompt) : prompt
  ),
});

/** Title and content are required; whitespace-only values are rejected. */
export const validateDraft = (
  draft: Pick<PromptDraft, "title" | "content">
): DraftErrors => {
  const errors: DraftErrors = {};
  if (draft.title.trim() === "") {
    errors.title = "blank";
  }
  if (draft.content.trim() === "") {
    errors.content = "blank";
  }
  return errors;
};

/**
 * Records a successful copy. Usage never changes the modification date, and a
 * late-arriving older use cannot move latest use backward.
 */
export const recordUse = (
  library: Library,
  id: PromptId,
  at: number
): Library =>
  mapPrompt(library, id, (prompt) => ({
    ...prompt,
    lastUsedAt: Math.max(prompt.lastUsedAt ?? Number.NEGATIVE_INFINITY, at),
    useCount: prompt.useCount + 1,
  }));

export const toggleFavorite = (
  library: Library,
  id: PromptId,
  at: number
): Library =>
  mapPrompt(library, id, (prompt) => ({
    ...prompt,
    favorite: !prompt.favorite,
    modifiedAt: at,
  }));

export const setArchived = (
  library: Library,
  id: PromptId,
  archived: boolean,
  at: number
): Library =>
  mapPrompt(library, id, (prompt) =>
    prompt.archived === archived
      ? prompt
      : { ...prompt, archived, modifiedAt: at }
  );

/**
 * Creates an independent active copy. The copy inherits text and organization
 * but never favourite status, dates or usage history.
 */
export const duplicatePrompt = (
  library: Library,
  id: PromptId,
  at: number,
  newId: PromptId
): Library => {
  const source = library.prompts.find((prompt) => prompt.id === id);
  if (!source) {
    return library;
  }

  const copy: Prompt = {
    ...source,
    id: newId,
    title: `${source.title} (copy)`,
    tagIds: [...source.tagIds],
    favorite: false,
    archived: false,
    createdAt: at,
    modifiedAt: at,
    lastUsedAt: null,
    useCount: 0,
  };

  return { ...library, prompts: [copy, ...library.prompts] };
};

const sameTags = (left: TagId[], right: TagId[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  const rightTags = new Set(right);
  return left.every((tag) => rightTags.has(tag));
};

/**
 * Saves a draft. The modification date moves only when something actually
 * changed; content is stored exactly as typed.
 */
export const savePrompt = (
  library: Library,
  id: PromptId,
  draft: PromptDraft,
  at: number
): Library =>
  mapPrompt(library, id, (prompt) => {
    const next: Prompt = {
      ...prompt,
      title: draft.title.trim(),
      description: draft.description.trim(),
      content: draft.content,
      collectionId: draft.collectionId,
      tagIds: [...draft.tagIds],
    };

    const unchanged =
      next.title === prompt.title &&
      next.description === prompt.description &&
      next.content === prompt.content &&
      next.collectionId === prompt.collectionId &&
      sameTags(next.tagIds, prompt.tagIds);

    return unchanged ? prompt : { ...next, modifiedAt: at };
  });

export const createPrompt = (
  library: Library,
  draft: PromptDraft,
  at: number,
  newId: PromptId
): Library => {
  const created: Prompt = {
    id: newId,
    title: draft.title.trim(),
    description: draft.description.trim(),
    content: draft.content,
    collectionId: draft.collectionId,
    tagIds: [...draft.tagIds],
    favorite: false,
    archived: false,
    createdAt: at,
    modifiedAt: at,
    lastUsedAt: null,
    useCount: 0,
  };

  return { ...library, prompts: [created, ...library.prompts] };
};

/** Permanent deletion: there is no trash or restore promise. */
export const deletePrompt = (library: Library, id: PromptId): Library => ({
  ...library,
  prompts: library.prompts.filter((prompt) => prompt.id !== id),
});

export interface ResolvedTags {
  library: Library;
  tagIds: TagId[];
}

/**
 * Resolves tag names to tag identities, creating any that do not exist.
 * Tag identity is case-insensitive after trimming; display capitalization of
 * the existing tag wins. Blank names are rejected.
 */
export const ensureTags = (library: Library, names: string[]): ResolvedTags => {
  const tags = [...library.tags];
  const tagIds: TagId[] = [];
  const claimed = new Set<TagId>();

  for (const raw of names) {
    const name = raw.trim();
    if (name === "") {
      continue;
    }
    const existing = tags.find(
      (tag) => tag.name.trim().toLowerCase() === name.toLowerCase()
    );
    const id =
      existing?.id ?? `t-${name.toLowerCase().replaceAll(/\s+/gu, "-")}`;
    if (!existing) {
      tags.push({ id, name });
    }
    if (!claimed.has(id)) {
      claimed.add(id);
      tagIds.push(id);
    }
  }

  return { library: { ...library, tags }, tagIds };
};
