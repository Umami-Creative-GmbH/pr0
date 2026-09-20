# Login methods

Issue [#28](https://github.com/Umami-Creative-GmbH/pr0/issues/28) adds explicit login-method management to Account security. It reuses schema version 6, the existing Better Auth account/state persistence, and browser-bound fresh-authentication proofs. No new migration, service, secret, or native permission is required.

Confirm the current password, or use the verified-email challenge for a social-only account, before linking Google/GitHub or removing a method. One identity per provider is supported. A provider can use a different email; linking preserves the verified account email and immutable library ownership. An identity owned by another account is refused. Matching provider emails never link accounts automatically.

OAuth state binds the initiating instance, account, browser session and email version. Callback completion consumes the state once and rechecks identity, browser provenance, session validity and the ten-minute proof. Cancellation, provider failure, changed email/account, revocation and expiry leave methods unchanged. Provider callbacks never grant fresh authentication themselves.

Removal is serialized under the account lock. Another usable password or enabled provider must remain; a disabled provider does not count. Removing a method invalidates authentication already in flight against older credentials, while retaining existing sessions and library data. Password recovery remains available through the verified account email and can add a password. Registration closure does not prevent existing owners from linking a method.

The shared validators, validated client and OpenAPI document expose:

- `GET /api/v1/account/methods`: owned methods, usability and enabled providers.
- `POST /api/v1/account/methods/link`: expected account/email version and provider; returns the validated provider authorization URL.
- `POST /api/v1/account/methods/remove`: expected account/email version and method identity.

These are browser-only operations. Mutations require the configured same origin. Unlisted Better Auth routes, including direct link/unlink and internal social-plugin paths, remain inaccessible. Responses are uncached; no passwords or provider tokens are returned.

Run `bun run --cwd apps/web test:login-methods` for the isolated production-server/PostgreSQL/SMTP acceptance suite, including registration-closed and disabled-provider restarts. See [validation evidence](../validation/login-methods-28.md) for results and browser checks.
