import "server-only";
import { createHash, randomBytes } from "node:crypto";

import { emailSchema, socialProviderSchema } from "@pr0/api-contract/accounts";
import type { SocialProvider } from "@pr0/api-contract/accounts";
import { APIError } from "better-auth/api";
import { z } from "zod";

import { database } from "./database";

export const socialHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const socialToken = () => randomBytes(32).toString("base64url");
export const invalidSocial = () =>
  new APIError("BAD_REQUEST", { code: "invalid_social" });

export const socialAccountOwner = async (provider: string, subject: string) => {
  const sql = database();
  const [owner] =
    await sql`SELECT u.email, u.email_verified FROM account a JOIN "user" u ON u.id = a.user_id
    WHERE a.provider_id = ${provider} AND a.account_id = ${subject}`;
  return owner;
};

export const accountEmailExists = async (email: string) => {
  const sql = database();
  const rows = await sql`SELECT id FROM "user" WHERE email = ${email}`;
  return rows.length > 0;
};

export const reserveSocialAttempt = async (state: string) => {
  const sql = database();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(26001)`;
    await tx`DELETE FROM social_attempt WHERE expires_at <= now()`;
    await tx`DELETE FROM social_pending WHERE expires_at <= now()`;
    await tx`DELETE FROM verification WHERE expires_at <= now()`;
    const [row] =
      await tx`SELECT (SELECT count(*) FROM social_attempt) + (SELECT count(*) FROM social_pending) AS count`;
    if (Number(row.count) >= 1000) {
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "unavailable",
        retryAfter: 60,
      });
    }
    await tx`INSERT INTO social_attempt(state_hash, expires_at) VALUES (${socialHash(state)}, now() + interval '10 minutes')`;
  });
};

export const consumeSocialAttempt = async (state: string) => {
  const sql = database();
  const rows =
    await sql`DELETE FROM social_attempt WHERE state_hash = ${socialHash(state)} AND expires_at > now() RETURNING state_hash`;
  if (!rows.length) {
    throw invalidSocial();
  }
};

export const createPendingSocial = async (
  provider: SocialProvider,
  subject: string
) => {
  const token = socialToken();
  const sql = database();
  await sql`INSERT INTO social_pending(id_hash, provider, subject, expires_at)
    VALUES (${socialHash(token)}, ${provider}, ${subject}, now() + interval '1 hour')`;
  return token;
};

const pendingSchema = z.object({
  provider: socialProviderSchema,
  subject: z.string().min(1).max(255),
  email: emailSchema.nullable(),
  expires_at: z.date(),
});
export const pendingSocial = async (token: string) => {
  const sql = database();
  const [row] =
    await sql`SELECT provider, subject, email, expires_at FROM social_pending
    WHERE id_hash = ${socialHash(token)} AND expires_at > now()`;
  const parsed = pendingSchema.safeParse(row);
  if (!parsed.success) {
    throw invalidSocial();
  }
  return parsed.data;
};

export const consumePendingSocial = async (
  browserToken: string,
  emailToken: string
) => {
  const sql = database();
  const [row] =
    await sql`DELETE FROM social_pending WHERE id_hash = ${socialHash(browserToken)}
    AND token_hash = ${socialHash(emailToken)} AND expires_at > now() AND email IS NOT NULL
    RETURNING provider, subject, email, expires_at`;
  const parsed = pendingSchema.safeParse(row);
  if (!parsed.success || !parsed.data.email) {
    throw invalidSocial();
  }
  return { ...parsed.data, email: parsed.data.email };
};
