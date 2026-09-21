import "server-only";
import type { accountErrorSchema } from "@pr0/api-contract/accounts";
import type { PromptError } from "@pr0/api-contract/prompts";
import type { z } from "zod";

import { workDatabase } from "./database";

let recording = 0;
export const recordFailure = (
  boundary: "account" | "request" | "mutation",
  code: z.infer<typeof accountErrorSchema>["code"] | PromptError["code"]
) => {
  // Only fixed vocabulary enters logs: no URLs, bodies, identities, errors or credentials.
  process.stderr.write(
    `${JSON.stringify({ event: "request_failed", boundary, code, at: new Date().toISOString() })}\n`
  );
  if (recording >= 64) {
    return;
  }
  recording += 1;
  void (async () => {
    try {
      await workDatabase()`INSERT INTO operational_counter(boundary,code) VALUES (${boundary},${code})
        ON CONFLICT(day,boundary,code) DO UPDATE SET count=operational_counter.count+1`;
    } catch {
      process.stderr.write('{"event":"metrics_unavailable"}\n');
    } finally {
      recording -= 1;
    }
  })();
};
