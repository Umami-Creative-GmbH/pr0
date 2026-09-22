import "server-only";
import { createAuthMiddleware } from "better-auth/api";

const browserCookieLifetimeSeconds = 400 * 24 * 60 * 60;
const maxAgeAttribute = /;\s*Max-Age=\d+/iu;
const signInPaths = new Set([
  "/sign-in/email",
  "/social/callback/:provider",
  "/social/verify",
]);

export const sessionCookiePolicy = createAuthMiddleware(async (ctx) => {
  const headers = ctx.context.responseHeaders;
  if (!headers) {
    return;
  }
  const previousToken = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret
  );
  const issuedToken = ctx.context.newSession?.session.token;
  // Social callbacks also link login methods. Their session checks renew the
  // existing token; only a newly issued credential may replace the cookie.
  const signingIn =
    signInPaths.has(ctx.path) && issuedToken && issuedToken !== previousToken;
  const cookies = headers.getSetCookie();
  const sessionCookies = new Set(
    Object.values(ctx.context.authCookies).map((cookie) => cookie.name)
  );
  headers.delete("set-cookie");
  for (const cookie of cookies) {
    const name = cookie.slice(0, cookie.indexOf("="));
    if (!sessionCookies.has(name)) {
      headers.append("set-cookie", cookie);
    } else if (signingIn) {
      headers.append(
        "set-cookie",
        name === ctx.context.authCookies.sessionToken.name
          ? cookie.replace(
              maxAgeAttribute,
              `; Max-Age=${browserCookieLifetimeSeconds}`
            )
          : cookie
      );
    }
  }
  // Database renewal still runs. A response cannot know the browser's current
  // account, so neither renewal nor expiry/revocation may rewrite its cookies.
  // Sign-out revokes the server session; its now-useless cookie stays until the
  // next sign-in or its absolute expiry, avoiding a delayed logout/login race.
});
