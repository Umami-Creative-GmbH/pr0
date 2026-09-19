import {
  librarySchema,
  socialRedirectSchema,
} from "@pr0/api-contract/accounts";

import { cookieFrom, ingressHeaders, origin, post } from "./http-fixture";

export const statusOf = async (response: Promise<Response>) => {
  const result = await response;
  return result.status;
};
export const stateFrom = async (response: Response) => {
  const { url } = socialRedirectSchema.parse(await response.json());
  return new URL(url).searchParams.get("state");
};
export const libraryFor = async (Cookie: string) => {
  const response = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie, ...ingressHeaders() },
  });
  return librarySchema.parse(await response.json());
};

export const githubLogin = async (
  id: string,
  email?: string,
  verified = true,
  headers: Record<string, string> = {}
) => {
  const start = await post(
    "/api/auth/sign-in/social",
    { provider: "github" },
    headers
  );
  const { url } = await start.json();
  const state = new URL(url).searchParams.get("state");
  const code = Buffer.from(JSON.stringify({ id, email, verified })).toString(
    "base64url"
  );
  return fetch(
    `${origin}/api/auth/callback/github?state=${state}&code=${code}`,
    {
      headers: {
        ...ingressHeaders(),
        Cookie: cookieFrom(start),
        "Sec-Fetch-Site": "cross-site",
        ...headers,
      },
      redirect: "manual",
    }
  );
};

export const googleLogin = async (
  extra: {
    aud?: string;
    nonce?: string;
    iss?: string;
    exp?: number;
    badSignature?: boolean;
  } = {}
) => {
  const start = await post("/api/auth/sign-in/social", {
    provider: "google",
  });
  const { url } = await start.json();
  const authorization = new URL(url);
  const code = Buffer.from(
    JSON.stringify({
      sub: crypto.randomUUID(),
      email: `${crypto.randomUUID()}@example.test`,
      email_verified: true,
      nonce: authorization.searchParams.get("nonce"),
      ...extra,
    })
  ).toString("base64url");
  return fetch(
    `${origin}/api/auth/callback/google?state=${authorization.searchParams.get("state")}&code=${code}`,
    {
      headers: { ...ingressHeaders(), Cookie: cookieFrom(start) },
      redirect: "manual",
    }
  );
};
