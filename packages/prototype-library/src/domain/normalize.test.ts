import { expect, test } from "bun:test";

import { normalize, queryTerms } from "./normalize";

test("folds case, accents and the German sharp s", () => {
  expect(normalize("Café")).toBe("cafe");
  expect(normalize("Über")).toBe("uber");
  expect(normalize("Straße")).toBe("strasse");
  expect(normalize("STRASSE")).toBe("strasse");
});

test("trims and collapses whitespace without rewriting punctuation", () => {
  expect(normalize("  CAFE  ")).toBe("cafe");
  expect(normalize("German    email")).toBe("german email");
  expect(normalize("C++")).toBe("c++");
});

test("does not transliterate or correct typos", () => {
  expect(normalize("ueber")).not.toBe(normalize("Über"));
  expect(normalize("sumamrize")).not.toBe(normalize("summarize"));
});

test("splits a query into terms, ignoring extra whitespace", () => {
  expect(queryTerms("  German   email ")).toEqual(["german", "email"]);
  expect(queryTerms("   ")).toEqual([]);
  expect(queryTerms("")).toEqual([]);
});
