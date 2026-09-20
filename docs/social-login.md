# Google and GitHub sign-in

Each instance owns its provider applications, credentials, accounts, and libraries. Email/password and verified-email recovery work with both social providers disabled.

## Operator configuration

Set `PR0_ORIGIN` to the canonical HTTPS origin. Register these exact callback URLs:

- Google: `https://<instance-host>/api/auth/callback/google`
- GitHub: `https://<instance-host>/api/auth/callback/github`

For Google, create a Web application OAuth client, configure the consent screen and authorized origin, and request `openid email profile`. Development applications may need explicitly admitted test users. For GitHub, register an OAuth App with the instance homepage and callback; the application requests `read:user user:email`. Use separate development/production applications. Local HTTP is accepted only on localhost/loopback origins; register the matching local callback with the provider.

Set `PR0_GOOGLE_CLIENT_ID` and `PR0_GOOGLE_CLIENT_SECRET`, and/or `PR0_GITHUB_CLIENT_ID` and `PR0_GITHUB_CLIENT_SECRET`. Secrets also support the corresponding `_FILE` variable. With Compose secrets, mount the files into `web` and any operations/worker services receiving those variables. Never commit real credentials or expose them through `NEXT_PUBLIC_*`. Compose passes configuration at runtime; restart the services after changing it. A client ID without its secret fails configuration. An absent client ID disables that provider: its button is omitted and direct start/callback attempts return `not_found`.

Run the ordinary `accounts migrate` operation before starting the updated server. Migration 005 adds expiring, hashed OAuth attempts and pending email proofs. No provider access/refresh/ID tokens are persisted by this slice.

Closed/open/allowlist registration applies when a new account is created, including after collected-email verification. Closed first-account admission and allowlist commands are the same as email/password registration. Existing provider identities can still sign in when registration is closed. Keep SMTP configured for account verification and recovery, including social-only accounts.

New-account attempts share the email/password signup limit of five per hour per trusted IP bucket. Successful returning-provider sign-in does not spend this signup budget. Authentication burst/minute limits and email destination/IP limits also apply. An existing-email collision continues to offer login/recovery guidance under closed registration or after removal from the allowlist.

## Account behavior

Provider subjects bind to immutable account IDs. Changing or losing the provider's email does not change an established verified account address or library. An unlinked provider with an existing account email never automatically links or merges; the sign-in screen directs the user to the original login or recovery. Explicit linking remains a separate feature.

Without a usable verified provider email, the browser receives a one-hour pending identity, not a session. The user supplies an email, opens the mailed link in the same browser, and explicitly confirms verification. The newest request invalidates the older email token without extending expiry. The token is delivered in a URL fragment, stored only as a hash on the server, and requires the signed HttpOnly pending cookie. Delivery failure leaves the account uncreated and library closed. Expired attempts can be restarted from sign-in. A completed social account can use the existing verified-email password-recovery flow.

## Validation

Run `bun run --cwd apps/web test:social` with Docker available. The runner builds the production application, starts disposable PostgreSQL and SMTP services, tests each policy through served HTTP, and removes its containers afterwards. It reserves localhost ports 30426, 55426, 11426, and 18426. See the [recorded issue #26 evidence](validation/social-login-26.md).

The acceptance harness uses disposable PostgreSQL/SMTP, the actual Next.js/Bun server, and provider HTTP fixtures loaded only by Bun's test preload. Production configuration has no fixture switch or provider endpoint override. Google fixtures use signed RSA ID tokens and a controlled JWKS response; signatures, issuer, audience, expiry and nonce are checked by Better Auth.

Live provider evidence is an operator release check: with each real application, record date, instance origin, provider, successful signup/returning login, denial, verified account email, and missing-email completion where available. Do not record authorization codes, tokens, cookies, or secrets. No live operator credentials were supplied for issue #26, so automated fixtures are not a claim of real Google/GitHub consent-screen validation.

Provider references: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [GitHub email API](https://docs.github.com/en/rest/users/emails), [Better Auth account linking](https://better-auth.com/docs/concepts/users-accounts).
