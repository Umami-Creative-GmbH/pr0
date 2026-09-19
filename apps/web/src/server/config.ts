import "server-only";
import { readFileSync } from "node:fs";

export const secret = (name: string): string => {
  const file = process.env[`${name}_FILE`];
  const value = file ? readFileSync(file, "utf-8").trim() : process.env[name];
  if (!value) {
    throw new Error(`Configure ${name} or ${name}_FILE`);
  }
  return value;
};

export const configuration = () => {
  const origin = new URL(process.env.PR0_ORIGIN ?? "http://localhost:3000");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !(origin.protocol === "https:" || (local && origin.protocol === "http:"))
  ) {
    throw new Error(
      "PR0_ORIGIN must be a canonical HTTPS origin (HTTP is local only)"
    );
  }
  const authSecret = secret("BETTER_AUTH_SECRET");
  if (authSecret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  const registration = process.env.PR0_REGISTRATION ?? "closed";
  if (!["closed", "open", "allowlist"].includes(registration)) {
    throw new Error("PR0_REGISTRATION must be closed, open, or allowlist");
  }
  return {
    origin: origin.origin,
    secure: origin.protocol === "https:",
    authSecret,
    registration,
  };
};
