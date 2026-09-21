import { z } from "zod";

export const healthPath = "/api/v1/health";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

const readinessCheck = z.enum(["ready", "unavailable"]);
export const readinessResponseSchema = z.strictObject({
  status: readinessCheck,
  checks: z.strictObject({
    schema: readinessCheck,
    deletionReplay: readinessCheck,
    email: readinessCheck,
    search: z.enum(["ready", "search_preparing", "unavailable"]),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
