import { z } from "zod";

/**
 * The availability bound: the probe aborts its requests after this long, and
 * a slower sample never counts as an available minute.
 */
export const availabilityBoundMs = 15_000;

/** One availability probe observation, as written to the evidence files and stdout. */
export const availabilitySampleSchema = z.strictObject({
  at: z.iso.datetime(),
  available: z.boolean(),
  durationMs: z.number().nonnegative(),
});
export type AvailabilitySample = z.infer<typeof availabilitySampleSchema>;

/**
 * Instance configuration settings. Operator tools take them only from the
 * deployment's own .env and drop them from the shell they run in.
 */
export const instanceConfigurationPattern =
  /^(?:PR0_|SMTP_|COMPOSE_|DATABASE_URL|BETTER_AUTH_|POSTGRES_)/u;

const maximumQuotedOutput = 200;

/**
 * Parses an operator command's result, which every command writes as JSON on
 * its last stdout line after any progress output.
 */
export const parseLastJsonLine = <T extends z.ZodType>(
  schema: T,
  output: string
): z.infer<T> => {
  const line = output.trim().split("\n").at(-1) ?? "";
  try {
    return schema.parse(JSON.parse(line));
  } catch {
    throw new Error(
      `Unexpected command result: ${line.slice(0, maximumQuotedOutput)}`
    );
  }
};
