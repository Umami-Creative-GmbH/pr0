// External provider HTTP fixture, loaded only by the acceptance runner.
// Production code and configuration expose no provider override or bypass.
import { generateKeyPairSync, sign } from "node:crypto";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = {
  ...keys.publicKey.export({ format: "jwk" }),
  kid: "fixture",
  alg: "RS256",
  use: "sig",
};
const realFetch = globalThis.fetch;
const fixtureFetch: typeof fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return Response.json({ keys: [publicKey] });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init?.body));
      const profile = JSON.parse(
        Buffer.from(body.get("code") ?? "", "base64url").toString()
      );
      const header = Buffer.from(
        JSON.stringify({ alg: "RS256", kid: "fixture" })
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          iss: "https://accounts.google.com",
          aud: "fixture-google",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 600,
          ...profile,
        })
      ).toString("base64url");
      const unsigned = `${header}.${payload}`;
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(unsigned),
        keys.privateKey
      ).toString("base64url");
      return Response.json({
        access_token: "fixture",
        token_type: "bearer",
        id_token: `${unsigned}.${profile.badSignature ? "invalid" : signature}`,
      });
    }
    if (url === "https://github.com/login/oauth/access_token") {
      const body = new URLSearchParams(String(init?.body));
      return Response.json({
        access_token: body.get("code"),
        token_type: "bearer",
        scope: "read:user,user:email",
      });
    }
    if (url.startsWith("https://api.github.com/user")) {
      const token =
        new Headers(init?.headers).get("authorization")?.slice(7) ?? "";
      const profile = JSON.parse(Buffer.from(token, "base64url").toString());
      if (url.endsWith("/emails")) {
        return Response.json(
          profile.email
            ? [
                {
                  email: profile.email,
                  verified: profile.verified,
                  primary: true,
                },
              ]
            : []
        );
      }
      return Response.json({
        id: profile.id,
        login: "fixture",
        email: profile.email,
      });
    }
    return await realFetch(input, init);
  },
  { preconnect: realFetch.preconnect }
);
globalThis.fetch = fixtureFetch;
