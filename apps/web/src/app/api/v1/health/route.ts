import { healthResponseSchema } from "@pr0/api-contract/health";

import { corsHeaders, preflightResponse } from "@/lib/cors";

export const GET = (request: Request) =>
  Response.json(healthResponseSchema.parse({ status: "ok" }), {
    headers: {
      ...Object.fromEntries(corsHeaders(request)),
      "Cache-Control": "no-store",
    },
  });

export const OPTIONS = (request: Request) => preflightResponse(request);
