// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Counter queries share one serialized PostgreSQL transaction.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { configuration, secret } from "./config";
import { database } from "./database";

type FailureCode =
  | "invalid_credentials"
  | "account_changed"
  | "fresh_auth_required"
  | "invalid_challenge"
  | "email_change_unavailable"
  | "forbidden"
  | "registration_closed"
  | "rate_limited"
  | "invalid_input"
  | "invalid_recovery"
  | "unauthenticated"
  | "email_unverified"
  | "not_found"
  | "unavailable";
export class AccountFailureError extends Error {
  readonly code: FailureCode;
  readonly status: number;
  readonly retryAfter?: number;
  constructor(code: FailureCode, status: number, retryAfter?: number) {
    super(code);
    this.name = "AccountFailureError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export const clientBucket = (request: Request): string => {
  // Next's Request does not expose the peer socket. Without authenticated ingress,
  // use a conservative shared bucket, never attacker-controlled forwarding headers.
  if (!process.env.PR0_INGRESS_SECRET && !process.env.PR0_INGRESS_SECRET_FILE) {
    return "untrusted";
  }
  const expected = Buffer.from(secret("PR0_INGRESS_SECRET"));
  const provided = Buffer.from(
    request.headers.get("x-pr0-ingress-secret") ?? ""
  );
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return "untrusted";
  }
  const address = request.headers.get("x-pr0-client-ip") ?? "";
  const version = isIP(address);
  if (version === 4) {
    return address;
  }
  if (version === 6) {
    const expanded = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [left = "", right = ""] = expanded.split("::");
    const prefix = left ? left.split(":") : [];
    const suffix = right ? right.split(":") : [];
    const groups = expanded.includes("::")
      ? [
          ...prefix,
          ...Array.from(
            { length: 8 - prefix.length - suffix.length },
            () => "0"
          ),
          ...suffix,
        ]
      : prefix;
    return `${groups.slice(0, 4).join(":")}::/64`;
  }
  return "untrusted";
};

export const assertOrigin = (request: Request, emailNavigation = false) => {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== configuration().origin) ||
    (request.method !== "GET" && origin !== configuration().origin) ||
    (!emailNavigation && request.headers.get("sec-fetch-site") === "cross-site")
  ) {
    throw new AccountFailureError("forbidden", 403);
  }
};

export interface Limit {
  key: string;
  max: number;
  seconds: number;
}
interface AdmissionReceipt {
  key: string;
  startedAt: Date;
}

export const admit = async (limits: Limit[]) => {
  const sql = database();
  const result = await sql.begin(async (tx) => {
    // One small serial transaction makes multi-bucket admission atomic across workers.
    await tx`SELECT pg_advisory_xact_lock(24003)`;
    await tx`DELETE FROM admission_bucket WHERE started_at < now() - interval '1 day'`;
    let retry = 0;
    const receipts: AdmissionReceipt[] = [];
    for (const limit of limits) {
      const key = createHmac("sha256", configuration().authSecret)
        .update(limit.key)
        .digest("hex");
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- All counters share this serial transaction and must commit together.
      const rows =
        await tx`INSERT INTO admission_bucket(key, started_at, count) VALUES (${key}, now(), 1)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE WHEN admission_bucket.started_at + ${limit.seconds} * interval '1 second' <= now() THEN 1 ELSE admission_bucket.count + 1 END,
          started_at = CASE WHEN admission_bucket.started_at + ${limit.seconds} * interval '1 second' <= now() THEN now() ELSE admission_bucket.started_at END
        RETURNING count, started_at, ceil(extract(epoch FROM started_at + ${limit.seconds} * interval '1 second' - now()))::int AS retry`;
      receipts.push({ key, startedAt: rows[0].started_at });
      if (rows[0].count > limit.max) {
        retry = Math.max(retry, rows[0].retry);
      }
    }
    return { retry, receipts };
  });
  if (result.retry) {
    throw new AccountFailureError("rate_limited", 429, result.retry);
  }
  return result.receipts;
};

export const refundAdmission = async (receipts: AdmissionReceipt[]) => {
  const sql = database();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(24003)`;
    for (const receipt of receipts) {
      await tx`UPDATE admission_bucket SET count = greatest(0, count - 1) WHERE key = ${receipt.key} AND started_at = ${receipt.startedAt}`;
    }
  });
};

export const admitEmail = (email: string, ip: string) =>
  admit([
    { key: `email:destination:${email}`, max: 3, seconds: 3600 },
    { key: `email:ip:${ip}`, max: 20, seconds: 3600 },
  ]);

export const assertRegistration = async (email: string) => {
  if (configuration().registration === "open") {
    return;
  }
  const sql = database();
  const admission =
    await sql`SELECT email FROM registration_admission WHERE email = ${email}
      AND (${configuration().registration === "allowlist"} OR (first_account AND NOT EXISTS (SELECT 1 FROM "user")))`;
  if (!admission.length) {
    throw new AccountFailureError("registration_closed", 403);
  }
};
