import { expect, test } from "bun:test";

import { z } from "zod";

import { availabilitySampleSchema, parseLastJsonLine } from "./operator-output";

test("an operator result is read from the last stdout line after progress output", () => {
  expect(
    parseLastJsonLine(
      availabilitySampleSchema,
      'progress\n{"at":"2026-11-10T12:00:00.000Z","available":true,"durationMs":12}\n'
    )
  ).toEqual({
    at: "2026-11-10T12:00:00.000Z",
    available: true,
    durationMs: 12,
  });
});

test("a missing, malformed or unexpected result is refused with the offending line", () => {
  expect(() => parseLastJsonLine(z.json(), "")).toThrow(
    "Unexpected command result: "
  );
  expect(() => parseLastJsonLine(z.json(), "{\nnot json")).toThrow(
    "Unexpected command result: not json"
  );
  expect(() =>
    parseLastJsonLine(
      availabilitySampleSchema,
      '{"at":"now","available":true,"durationMs":1}'
    )
  ).toThrow("Unexpected command result");
});
