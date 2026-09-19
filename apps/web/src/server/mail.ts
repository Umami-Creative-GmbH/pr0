import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { createTransport } from "nodemailer";
import { z } from "zod";

import { configuration, secret } from "./config";
import { database } from "./database";

const key = () => {
  const value = secret("PR0_MAIL_SECRET");
  if (value.length < 32) {
    throw new Error("PR0_MAIL_SECRET must contain at least 32 characters");
  }
  return createHash("sha256").update(value).digest();
};

const enqueueMail = async (
  email: string,
  url: string,
  expiresAt: Date,
  reservation: string,
  purpose: "verification" | "recovery"
) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify({ email, url, purpose }), "utf-8"),
    cipher.final(),
  ]);
  const encrypted = Buffer.concat([
    nonce,
    cipher.getAuthTag(),
    payload,
  ]).toString("base64");
  const sql = database();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(24004)`;
    const held =
      await tx`SELECT id FROM mail_reservation WHERE id = ${reservation} AND expires_at > now() FOR UPDATE`;
    if (!held.length) {
      throw new Error("Email admission expired");
    }
    await tx`INSERT INTO mail_job(id, payload, expires_at) VALUES (${reservation}, ${encrypted}, ${expiresAt})`;
    await tx`DELETE FROM mail_reservation WHERE id = ${reservation}`;
  });
};

export const enqueueVerification = async (
  email: string,
  url: string,
  token: string,
  reservation: string
) => {
  const claims = z
    .object({ exp: z.number().int().positive() })
    .parse(
      JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf-8")
      )
    );
  await enqueueMail(
    email,
    url,
    new Date(claims.exp * 1000),
    reservation,
    "verification"
  );
};

export const enqueueRecovery = async (
  email: string,
  token: string,
  reservation: string
) => {
  const sql = database();
  const [record] =
    await sql`SELECT expires_at FROM verification WHERE identifier = ${`reset-password:${token}`}`;
  if (!record) {
    throw new Error("Recovery token unavailable");
  }
  // A fragment keeps the token out of HTTP request URLs, access logs and referrers.
  const url = `${configuration().origin}/reset-password#token=${encodeURIComponent(token)}`;
  await enqueueMail(email, url, record.expires_at, reservation, "recovery");
};

export const enqueueSocialVerification = (
  email: string,
  token: string,
  expiresAt: Date,
  reservation: string
) =>
  enqueueMail(
    email,
    `${configuration().origin}/social-email#token=${token}`,
    expiresAt,
    reservation,
    "verification"
  );

const transport = () => {
  const config = configuration();
  const host = process.env.SMTP_HOST;
  const sender = process.env.SMTP_FROM;
  if (!host || !sender) {
    throw new Error("Configure SMTP_HOST and SMTP_FROM");
  }
  const mode = process.env.SMTP_TLS ?? "starttls";
  if (
    !["starttls", "tls", "plain"].includes(mode) ||
    (mode === "plain" && config.secure)
  ) {
    throw new Error(
      "SMTP requires tls or starttls outside local HTTP evaluation"
    );
  }
  return createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? (mode === "tls" ? 465 : 587)),
    secure: mode === "tls",
    requireTLS: mode === "starttls",
    ignoreTLS: mode === "plain",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: secret("SMTP_PASSWORD") }
      : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10_000,
    logger: false,
    debug: false,
  });
};

export const validateMailConfiguration = () => {
  key();
  transport().close();
};

export const withMailReservation = async (
  operation: (reservation: string) => Promise<Response>
) => {
  // Every address reserves capacity before Better Auth can reveal whether it exists.
  validateMailConfiguration();
  const sql = database();
  const id = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(24004)`;
    await tx`DELETE FROM mail_reservation WHERE expires_at <= now()`;
    const [capacity] =
      await tx`SELECT (SELECT count(*) FROM mail_job WHERE state = 'pending') + (SELECT count(*) FROM mail_reservation) AS count`;
    if (Number(capacity.count) >= 1000) {
      throw new Error("Email queue unavailable");
    }
    await tx`INSERT INTO mail_reservation(id, expires_at) VALUES (${id}, now() + interval '5 minutes')`;
  });
  try {
    return await operation(id);
  } finally {
    await sql`DELETE FROM mail_reservation WHERE id = ${id}`;
  }
};

// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- The claim returns at most one job; sending and acknowledging it are dependent operations.
export const deliverMail = async () => {
  const sql = database();
  key();
  const smtp = transport();
  const jobs =
    await sql`UPDATE mail_job SET attempts = attempts + 1, next_attempt_at = now() + interval '60 seconds'
    WHERE id = (SELECT id FROM mail_job WHERE state = 'pending' AND attempts < 5 AND next_attempt_at <= now()
      AND expires_at > now() + interval '30 seconds' ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, payload, attempts, expires_at`;
  for (const job of jobs) {
    try {
      const encrypted = Buffer.from(job.payload, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key(),
        encrypted.subarray(0, 12)
      );
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const decoded = JSON.parse(
        Buffer.concat([
          decipher.update(encrypted.subarray(28)),
          decipher.final(),
        ]).toString("utf-8")
      );
      await smtp.sendMail({
        from: process.env.SMTP_FROM,
        to: decoded.email,
        messageId: `<${job.id}@pr0.local>`,
        subject:
          decoded.purpose === "recovery"
            ? "Reset your pr0 password"
            : "Verify your pr0 email",
        text: `${decoded.purpose === "recovery" ? "Reset your password to recover your pr0 account" : "Verify your email to access your private pr0 library"}:\n\n${decoded.url}\n\nThis link expires one hour after it was requested. If you did not request it, ignore this email.`,
      });
      await sql`UPDATE mail_job SET state = 'sent', payload = NULL, completed_at = now() WHERE id = ${job.id}`;
    } catch {
      const delay = Math.min(30 * 2 ** (job.attempts - 1), 600);
      await sql`UPDATE mail_job SET
        state = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
        payload = CASE WHEN attempts >= 5 THEN NULL ELSE payload END,
        completed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END,
        next_attempt_at = now() + ${delay} * interval '1 second' WHERE id = ${job.id}`;
      process.stderr.write(
        `${JSON.stringify({ event: "mail_delivery_failed", jobId: job.id, attempt: job.attempts, terminal: job.attempts >= 5 })}\n`
      );
    }
  }
  await sql`UPDATE mail_job SET state = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'expired' END,
    payload = NULL, completed_at = now() WHERE state = 'pending' AND
    (expires_at <= now() + interval '30 seconds' OR (attempts >= 5 AND next_attempt_at <= now()))`;
  await sql`DELETE FROM mail_job WHERE completed_at < now() - interval '7 days'`;
  try {
    await smtp.verify();
  } finally {
    smtp.close();
  }
  await sql`INSERT INTO worker_health(name, heartbeat_at) VALUES ('mail', now()) ON CONFLICT(name) DO UPDATE SET heartbeat_at = now()`;
};
