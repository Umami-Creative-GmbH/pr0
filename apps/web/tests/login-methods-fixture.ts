import { loginMethodsSchema } from "@pr0/api-contract/accounts";
import type {
  AccountIdentity,
  SocialProvider,
} from "@pr0/api-contract/accounts";

import {
  cookieFrom,
  ingressHeaders,
  mergeCookies,
  origin,
  post,
} from "./http-fixture";

export const startLink = async (
  browser: {
    Cookie: string;
    identity: AccountIdentity;
  },
  provider: SocialProvider = "google"
) => {
  const response = await post(
    "/api/v1/account/methods/link",
    { ...browser.identity, provider },
    { Cookie: browser.Cookie }
  );
  if (!response.ok) {
    throw new Error(
      `Link start failed: ${response.status} ${JSON.stringify(await response.json())}`
    );
  }
  const redirect = await response.json();
  const authorization = new URL(redirect.url);
  const Cookie = mergeCookies(browser.Cookie, cookieFrom(response));
  const complete = (
    subject: string,
    email?: string,
    cookie = Cookie,
    error?: string
  ) => {
    const profile =
      provider === "google"
        ? {
            sub: subject,
            email,
            email_verified: true,
            nonce: authorization.searchParams.get("nonce"),
          }
        : { id: subject, email, verified: true };
    const code = Buffer.from(JSON.stringify(profile)).toString("base64url");
    const query = new URLSearchParams({
      state: authorization.searchParams.get("state") ?? "",
      ...(error ? { error } : { code }),
    });
    return fetch(`${origin}/api/auth/callback/${provider}?${query}`, {
      headers: { ...ingressHeaders(), Cookie: cookie },
      redirect: "manual",
    });
  };
  return {
    complete,
    state: authorization.searchParams.get("state"),
    Cookie,
    stateCookie: cookieFrom(response)
      .split("; ")
      .filter(
        (cookie) =>
          cookie.startsWith("better-auth.state=") ||
          cookie.startsWith("better-auth.oauth_state=")
      )
      .join("; "),
  };
};
export const methodsFor = async (Cookie: string) => {
  const response = await fetch(`${origin}/api/v1/account/methods`, {
    headers: { Cookie, ...ingressHeaders() },
  });
  return loginMethodsSchema.parse(await response.json());
};
