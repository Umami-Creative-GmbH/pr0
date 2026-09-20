// Shared wire-level conformance vectors, usable by REST and later native checks.
export const invalidPromptTextFixtures = [
  { field: "title", value: "\u0085\u3000\t", reason: "blank Unicode title" },
  { field: "content", value: "\n\u2007", reason: "blank Unicode content" },
  { field: "title", value: "🌍".repeat(201), reason: "201 scalar title" },
  {
    field: "description",
    value: "🌍".repeat(2001),
    reason: "2001 scalar description",
  },
  { field: "content", value: "🌍".repeat(65_537), reason: "more than 256 KiB" },
  { field: "content", value: "before\u0000after", reason: "NUL" },
  {
    field: "title",
    value: "before\uD800after",
    reason: "unpaired high surrogate",
  },
  {
    field: "description",
    value: "before\uDC00after",
    reason: "unpaired low surrogate",
  },
] as const;
export const maximumPromptText = {
  title: "🌍".repeat(200),
  description: "🌍".repeat(2000),
  content: "🌍".repeat(65_536),
};
