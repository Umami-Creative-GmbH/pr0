import assert from "node:assert/strict";

import { utf8Bytes } from "@pr0/api-contract/prompts";

export const capacityBytes = 104_857_600;
export const capacityCount = 10_000;
export const capacityPhrase =
  "write concise answer useful examples clear steps review following document identify important changes explain reasoning preserve exact names punctuation summarize meeting notes actions owners dates";
export const capacityId = (number: number, group = 0) =>
  `00000000-0000-4000-${String(8000 + group)}-${String(number).padStart(12, "0")}`;
export const capacityCollections = Array.from({ length: 200 }, (_, index) => ({
  id: capacityId(index + 1, 1),
  name: `Réponses ${String(index + 1).padStart(3, "0")}`,
  revision: "10000",
  activeCount: 50,
  archivedCount: 0,
  totalCount: 50,
}));
export const capacityTags = Array.from({ length: 1000 }, (_, index) => ({
  id: capacityId(index + 1, 2),
  name: `Équipe ${String(index + 1).padStart(4, "0")}`,
  revision: "10000",
  activeCount: 200,
  archivedCount: 0,
  totalCount: 200,
}));
export const capacityOrganizationBytes = [
  ...capacityCollections,
  ...capacityTags,
].reduce((sum, item) => sum + utf8Bytes(item.name), 0);

// A deterministic corpus with combining marks, case folds, non-Latin scripts,
// astral scalars and literal syntax. Distinct bodies avoid a repeated-prose-only index.
const alphabet = [
  ..."abcdefghijklmnopqrstuvwxyz0123456789éßΣςİ中日本語🎯🫠%_[]+\\",
];
export const capacityNoise = (bytes: number, seed: number) => {
  let state = seed + 1;
  let used = 0;
  const characters: string[] = [];
  while (used < bytes) {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    const character = alphabet[state % alphabet.length] ?? "x";
    const size = utf8Bytes(character);
    if (used + size > bytes) {
      characters.push("x".repeat(bytes - used));
      break;
    }
    characters.push(character);
    used += size;
  }
  return characters.join("");
};
export const capacityText = (number: number) => {
  const title = `Prompt ${String(number).padStart(5, "0")} Café`;
  const description = "Résumé Straße Σίσυφος 東京";
  const available = capacityBytes - capacityOrganizationBytes;
  const target =
    Math.floor(available / capacityCount) +
    Number(number <= available % capacityCount);
  const prefix = `${capacityPhrase} common C++ abc bcd Cafe\u0301 Straße Σίσυφος 東京 🎯 {{name}} `;
  const content =
    prefix +
    capacityNoise(
      target - utf8Bytes(title) - utf8Bytes(description) - utf8Bytes(prefix),
      number
    );
  assert.equal(utf8Bytes(title + description + content), target);
  return { title, description, content };
};
