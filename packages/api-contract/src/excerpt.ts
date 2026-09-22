import { z } from "zod";

import rule from "./excerpt-rule.json";

// The native adapter consumes the same pinned White_Space set and scalar limit.
const whitespace = new RegExp(`[${rule.whitespace}]+`, "gu");
export const contentExcerpt = (content: string): string =>
  [...content.replace(whitespace, " ").replaceAll(/^ | $/gu, "")]
    .slice(0, rule.maxCodePoints)
    .join("")
    .replace(/ $/u, "");

export const excerptSchema = z
  .string()
  .regex(new RegExp(`^[\\s\\S]{0,${rule.maxCodePoints}}$`, "u"))
  .describe(
    "Content excerpt: at most 140 Unicode code points, pinned Unicode White_Space collapsed and trimmed. Markup and prompt variables remain literal text; no ellipsis is appended."
  );
