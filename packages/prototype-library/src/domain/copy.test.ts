import { expect, mock, test } from "bun:test";

import { applyCopyToLauncher, copyPrompt, resolveSelection } from "./copy";
import type { Library, Prompt } from "./types";

const prompt = (overrides: Partial<Prompt> & { id: string }): Prompt => ({
  title: "Untitled",
  description: "",
  content: "body",
  collectionId: null,
  tagIds: [],
  favorite: false,
  archived: false,
  createdAt: 0,
  modifiedAt: 0,
  lastUsedAt: null,
  useCount: 0,
  ...overrides,
});

const library = (prompts: Prompt[]): Library => ({
  prompts,
  collections: [],
  tags: [],
});

// --- Selection identity -----------------------------------------------------

test("keeps the selected prompt while it remains eligible", () => {
  const results = [
    prompt({ id: "a" }),
    prompt({ id: "b" }),
    prompt({ id: "c" }),
  ];
  expect(resolveSelection("b", results)).toBe("b");
});

test("keeps selection by identity when the row position moves", () => {
  const reordered = [
    prompt({ id: "c" }),
    prompt({ id: "b" }),
    prompt({ id: "a" }),
  ];
  expect(resolveSelection("b", reordered)).toBe("b");
});

test("falls back to the first result when the selection disappears", () => {
  expect(
    resolveSelection("gone", [prompt({ id: "a" }), prompt({ id: "b" })])
  ).toBe("a");
});

test("selects nothing when no results remain", () => {
  expect(resolveSelection("a", [])).toBeNull();
  expect(resolveSelection(null, [])).toBeNull();
});

test("selects the first result when nothing was selected", () => {
  expect(resolveSelection(null, [prompt({ id: "a" })])).toBe("a");
});

// --- Copy outcomes ----------------------------------------------------------

test("a successful copy writes the content and records use", async () => {
  const writer = mock(() => Promise.resolve());
  const lib = library([prompt({ id: "p", content: "hello" })]);

  const result = await copyPrompt({
    writer,
    library: lib,
    promptId: "p",
    now: 1234,
  });

  expect(writer).toHaveBeenCalledWith("hello");
  expect(result.outcome.status).toBe("copied");
  expect(result.library.prompts[0]?.lastUsedAt).toBe(1234);
  expect(result.library.prompts[0]?.useCount).toBe(1);
});

test("a failed copy records no usage and leaves the library untouched", async () => {
  const writer = mock(() => Promise.reject(new Error("clipboard blocked")));
  const lib = library([prompt({ id: "p", content: "hello" })]);

  const result = await copyPrompt({
    writer,
    library: lib,
    promptId: "p",
    now: 1234,
  });

  expect(result.outcome.status).toBe("failed");
  expect(result.library).toBe(lib);
  expect(result.library.prompts[0]?.lastUsedAt).toBeNull();
  expect(result.library.prompts[0]?.useCount).toBe(0);
});

test("copies the variable-resolved text when values are supplied", async () => {
  const writer = mock(() => Promise.resolve());
  const lib = library([prompt({ id: "p", content: "Hi {{name}}" })]);

  await copyPrompt({
    writer,
    library: lib,
    promptId: "p",
    now: 1,
    variableValues: { name: "Jana" },
  });

  expect(writer).toHaveBeenCalledWith("Hi Jana");
});

// --- Launcher close-on-success ---------------------------------------------

const launcher = { open: true, query: "ema", selectedId: "p", error: null };

test("the launcher closes only after a successful clipboard write", () => {
  const next = applyCopyToLauncher(launcher, {
    status: "copied",
    text: "hello",
  });

  expect(next.open).toBe(false);
  expect(next.error).toBeNull();
});

test("a failed copy keeps the launcher open with its query and selection", () => {
  const next = applyCopyToLauncher(launcher, {
    status: "failed",
    message: "clipboard blocked",
  });

  expect(next.open).toBe(true);
  expect(next.query).toBe("ema");
  expect(next.selectedId).toBe("p");
  expect(next.error).toBe("clipboard blocked");
});

test("a successful retry after a failure closes the launcher", () => {
  const failed = applyCopyToLauncher(launcher, {
    status: "failed",
    message: "clipboard blocked",
  });
  const retried = applyCopyToLauncher(failed, {
    status: "copied",
    text: "hello",
  });

  expect(retried.open).toBe(false);
  expect(retried.error).toBeNull();
});
