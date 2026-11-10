import { expect, test } from "bun:test";

import { hasLegalLinks, readLegalLinks } from "./legal-links";

test("unconfigured legal links stay absent with no built-in defaults", () => {
  const links = readLegalLinks({
    PR0_IMPRESSUM_URL: "",
    PR0_PRIVACY_URL: "  ",
  });
  expect(links).toEqual({});
  expect(hasLegalLinks(links)).toBe(false);
});

test("configured legal links are validated and normalized", () => {
  const links = readLegalLinks({
    PR0_IMPRESSUM_URL: " https://Example.org/impressum ",
    PR0_TERMS_URL: "https://example.org/terms",
  });
  expect(links).toEqual({
    impressum: "https://example.org/impressum",
    terms: "https://example.org/terms",
  });
  expect(hasLegalLinks(links)).toBe(true);
});

test.each([
  ["PR0_IMPRESSUM_URL", "http://example.org/impressum"],
  ["PR0_PRIVACY_URL", `${"javascript"}:alert(1)`],
  ["PR0_TERMS_URL", "https://operator:secret@example.org/terms"],
  ["PR0_TERMS_URL", "example.org/terms"],
])("rejects an invalid %s at startup", (name, value) => {
  expect(() => readLegalLinks({ [name]: value })).toThrow(name);
});
