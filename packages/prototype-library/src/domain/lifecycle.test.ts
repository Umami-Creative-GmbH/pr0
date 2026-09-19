import { expect, test } from "bun:test";

import {
  deletePrompt,
  duplicatePrompt,
  ensureTags,
  recordUse,
  savePrompt,
  setArchived,
  toggleFavorite,
  validateDraft,
} from "./lifecycle";
import type { Library, Prompt } from "./types";

const CREATED = 1000;
const MODIFIED = 2000;
const NOW = 9000;

const prompt = (overrides: Partial<Prompt> & { id: string }): Prompt => ({
  title: "Writing helper",
  description: "Helps with writing",
  content: "Write about {{topic}}",
  collectionId: "c-work",
  tagIds: ["t-writing"],
  favorite: false,
  archived: false,
  createdAt: CREATED,
  modifiedAt: MODIFIED,
  lastUsedAt: null,
  useCount: 0,
  ...overrides,
});

const library = (prompts: Prompt[]): Library => ({
  prompts,
  collections: [{ id: "c-work", name: "Work", accent: "#0078D2" }],
  tags: [{ id: "t-writing", name: "Writing" }],
});

const find = (lib: Library, id: string): Prompt => {
  const found = lib.prompts.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`Missing prompt ${id}`);
  }
  return found;
};

// --- Usage ------------------------------------------------------------------

test("a successful copy records use without touching the modification date", () => {
  const next = recordUse(library([prompt({ id: "p" })]), "p", NOW);
  const updated = find(next, "p");

  expect(updated.lastUsedAt).toBe(NOW);
  expect(updated.useCount).toBe(1);
  expect(updated.modifiedAt).toBe(MODIFIED);
});

test("repeated copies move the same entry rather than adding rows", () => {
  const once = recordUse(library([prompt({ id: "p" })]), "p", NOW);
  const twice = recordUse(once, "p", NOW + 500);

  expect(twice.prompts).toHaveLength(1);
  expect(find(twice, "p").lastUsedAt).toBe(NOW + 500);
  expect(find(twice, "p").useCount).toBe(2);
});

test("an older arriving use cannot move latest use backward", () => {
  const recent = recordUse(library([prompt({ id: "p" })]), "p", NOW);
  const stale = recordUse(recent, "p", NOW - 5000);

  expect(find(stale, "p").lastUsedAt).toBe(NOW);
});

test("an archived prompt still records use", () => {
  const next = recordUse(
    library([prompt({ id: "p", archived: true })]),
    "p",
    NOW
  );
  expect(find(next, "p").lastUsedAt).toBe(NOW);
});

// --- Favourite and archive --------------------------------------------------

test("favourite and archive changes update the modification date", () => {
  const favorited = toggleFavorite(library([prompt({ id: "p" })]), "p", NOW);
  expect(find(favorited, "p").favorite).toBe(true);
  expect(find(favorited, "p").modifiedAt).toBe(NOW);

  const archived = setArchived(favorited, "p", true, NOW + 10);
  expect(find(archived, "p").archived).toBe(true);
  expect(find(archived, "p").modifiedAt).toBe(NOW + 10);
});

test("restoring retains organization and favourite status", () => {
  const archived = setArchived(
    library([prompt({ id: "p", favorite: true, archived: true })]),
    "p",
    false,
    NOW
  );
  const restored = find(archived, "p");

  expect(restored.archived).toBe(false);
  expect(restored.favorite).toBe(true);
  expect(restored.collectionId).toBe("c-work");
  expect(restored.tagIds).toEqual(["t-writing"]);
});

// --- Duplication ------------------------------------------------------------

test("duplicating an archived favourite produces an active, unfavourited copy", () => {
  const source = prompt({
    id: "p",
    favorite: true,
    archived: true,
    lastUsedAt: 5000,
    useCount: 4,
  });
  const next = duplicatePrompt(library([source]), "p", NOW, "copy-1");

  const copy = find(next, "copy-1");
  expect(copy.title).toBe("Writing helper (copy)");
  expect(copy.content).toBe(source.content);
  expect(copy.collectionId).toBe("c-work");
  expect(copy.tagIds).toEqual(["t-writing"]);
  expect(copy.favorite).toBe(false);
  expect(copy.archived).toBe(false);
  expect(copy.createdAt).toBe(NOW);
  expect(copy.modifiedAt).toBe(NOW);
  expect(copy.lastUsedAt).toBeNull();
  expect(copy.useCount).toBe(0);

  const original = find(next, "p");
  expect(original.archived).toBe(true);
  expect(original.favorite).toBe(true);
});

// --- Validation and saving --------------------------------------------------

test("rejects blank titles and blank content", () => {
  expect(validateDraft({ title: "   ", content: "text" })).toEqual({
    title: "blank",
  });
  expect(validateDraft({ title: "Title", content: "  \n " })).toEqual({
    content: "blank",
  });
  expect(validateDraft({ title: "Title", content: "text" })).toEqual({});
});

test("trims the title and description but preserves content exactly", () => {
  const next = savePrompt(
    library([prompt({ id: "p" })]),
    "p",
    {
      title: "  Writing helper 2  ",
      description: "  Trimmed  ",
      content: "  keep\tthis  ",
      collectionId: "c-work",
      tagIds: ["t-writing"],
    },
    NOW
  );
  const saved = find(next, "p");

  expect(saved.title).toBe("Writing helper 2");
  expect(saved.description).toBe("Trimmed");
  expect(saved.content).toBe("  keep\tthis  ");
  expect(saved.modifiedAt).toBe(NOW);
});

test("saving unchanged values does not change the modification date", () => {
  const original = prompt({ id: "p" });
  const next = savePrompt(
    library([original]),
    "p",
    {
      title: original.title,
      description: original.description,
      content: original.content,
      collectionId: original.collectionId,
      tagIds: [...original.tagIds],
    },
    NOW
  );

  expect(find(next, "p").modifiedAt).toBe(MODIFIED);
});

test("changing the collection assignment updates the modification date", () => {
  const original = prompt({ id: "p" });
  const next = savePrompt(
    library([original]),
    "p",
    {
      title: original.title,
      description: original.description,
      content: original.content,
      collectionId: null,
      tagIds: [...original.tagIds],
    },
    NOW
  );

  expect(find(next, "p").collectionId).toBeNull();
  expect(find(next, "p").modifiedAt).toBe(NOW);
});

// --- Permanent deletion -----------------------------------------------------

test("permanent deletion removes only the named prompt", () => {
  const next = deletePrompt(
    library([prompt({ id: "p" }), prompt({ id: "q" })]),
    "p"
  );

  expect(next.prompts.map((found) => found.id)).toEqual(["q"]);
});

test("resolves tag names case-insensitively and creates missing tags", () => {
  const base = library([prompt({ id: "p" })]);
  const { library: next, tagIds } = ensureTags(base, [
    "  writing  ",
    "Drafting",
    "WRITING",
    "  ",
  ]);

  expect(tagIds).toEqual(["t-writing", "t-drafting"]);
  expect(next.tags.map((tag) => tag.name)).toEqual(["Writing", "Drafting"]);
});
