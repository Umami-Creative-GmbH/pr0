import { expect, test } from "bun:test";

import {
  accentFor,
  accents,
  initials,
  relativeTime,
  statusTone,
} from "./present";

test("initials come from name parts, falling back to the first two letters", () => {
  expect(initials("jana.schmitt@umami-creative.de")).toBe("JS");
  expect(initials("Jana Schmitt")).toBe("JS");
  expect(initials("first-middle_last+tag@example.test")).toBe("FM");
  expect(initials("kai@example.test")).toBe("KA");
  expect(initials("x@example.test")).toBe("X");
});

test("initials never render an identifier fragment for missing identities", () => {
  expect(initials("")).toBe("?");
  expect(initials(null)).toBe("?");
  expect(initials("@example.test")).toBe("?");
});

test("a collection keeps one brand accent; no collection is neutral", () => {
  const id = "0b9c1a52-5d0e-4a39-9d0c-0f3f6d1f7a11";
  expect(accentFor(id)).toBe(accentFor(id));
  expect<readonly string[]>(accents).toContain(accentFor(id));
  expect(accentFor(null)).toBe("neutral");
  expect([...accents]).toEqual(["pink", "orange", "green", "blue"]);
  const used = new Set(
    Array.from({ length: 40 }, (_, index) => accentFor(`collection-${index}`))
  );
  expect(used.size).toBe(accents.length);
});

test("relative time is compact, monotonic and never negative", () => {
  const now = Date.parse("2026-09-21T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  expect(relativeTime(ago(20_000), now)).toBe("just now");
  expect(relativeTime(ago(-5 * minute), now)).toBe("just now");
  expect(relativeTime(ago(5 * minute), now)).toBe("5 min ago");
  expect(relativeTime(ago(3 * hour), now)).toBe("3 h ago");
  expect(relativeTime(ago(30 * hour), now)).toBe("yesterday");
  expect(relativeTime(ago(4 * day), now)).toBe("4 days ago");
  expect(relativeTime(ago(45 * day), now)).toBe(
    new Date(now - 45 * day).toLocaleDateString("en")
  );
  expect(relativeTime("not a date", now)).toBe("");
});

test("status tone never reports success for a state that is not settled", () => {
  expect(statusTone("Up to date at last check")).toBe("ok");
  expect(statusTone("Updating library…")).toBe("busy");
  expect(statusTone("Updating this device's library… · Changes waiting")).toBe(
    "busy"
  );
  expect(statusTone("Offline")).toBe("offline");
  expect(statusTone("Sign in to sync")).toBe("offline");
  expect(statusTone("Couldn't sync · Changes waiting")).toBe("attention");
  expect(statusTone("Library recovery required")).toBe("attention");
  expect(statusTone("Changes need attention")).toBe("attention");
  expect(statusTone("Some future label")).toBe("attention");
  expect(statusTone("Up to date at last check", true)).toBe("attention");
});
