import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";

import * as schema from "./schema";

export const client = new SQL(
  "postgres://pr0_validation:throwaway-validation-only@127.0.0.1:55413/pr0_validation",
  { max: 20 }
);
export const db = drizzle({ client, schema });
export const auth = betterAuth({
  baseURL: "http://localhost:30413",
  secret: "isolated-research-only-secret-at-least-32-characters",
  database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 30 * 24 * 60 * 60,
    updateAge: 0,
    freshAge: 600,
    cookieCache: { enabled: false },
  },
  rateLimit: { enabled: false },
  telemetry: { enabled: false },
  plugins: [
    bearer(),
    deviceAuthorization({
      validateClient: (id) => id === "pr0-desktop",
      interval: "1s",
    }),
  ],
});
