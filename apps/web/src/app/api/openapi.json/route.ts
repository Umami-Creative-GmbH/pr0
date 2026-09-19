import { openApiDocument } from "@pr0/api-contract/openapi";

import { corsHeaders, preflightResponse } from "@/lib/cors";

export const GET = (request: Request) =>
  Response.json(openApiDocument, { headers: corsHeaders(request) });

export const OPTIONS = (request: Request) => preflightResponse(request);
