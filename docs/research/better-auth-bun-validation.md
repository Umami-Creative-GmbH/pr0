# Better Auth on Bun-native PostgreSQL: runtime validation

Research for [issue 13](https://github.com/Umami-Creative-GmbH/pr0/issues/13), supporting [the storage decision](https://github.com/Umami-Creative-GmbH/pr0/issues/10) and [accepted account behavior](https://github.com/Umami-Creative-GmbH/pr0/issues/5). Checked 2026-09-19. This branch contains an isolated, disposable research harness; it does not implement application authentication.

## Result

**The pinned backend composition works in the tested environment.** Better Auth can generate its schema, run migrations, operate account/session records and issue independent device bearer sessions over Bun's native PostgreSQL client. Live integration tests passed against PostgreSQL, including adapter transaction rollback and concurrent one-use device-code redemption.

**A separate application guard is required for the accepted ten-minute fresh-authentication rule.** A live test demonstrates that an old browser session can approve a new desktop session, and the new session passes Better Auth's creation-age freshness guard without a new credential check. The adapter compatibility question is resolved; this product guarantee is not supplied by `freshAge: 600` alone.

The earlier [access report](https://github.com/Umami-Creative-GmbH/pr0/blob/72175823f63f671413cbfcebd460e38df9d31d68/docs/research/better-auth-access.md) established documented components only. The tests here add runtime evidence for the specific chain below, not a general guarantee about other versions or deployment configurations.

## Exact candidate and environment

| Component | Tested pin |
| --- | --- |
| JavaScript runtime | Bun 1.4.2, build `744846f84`, Windows x64 |
| Better Auth | `better-auth@1.7.5` |
| Database adapter | `@better-auth/drizzle-adapter@1.7.5`, default Relations v1 export |
| ORM and PostgreSQL driver | `drizzle-orm@0.45.2`, `drizzle-orm/bun-sql`, `SQL` imported from `bun` |
| Auth schema generator | `auth@1.7.5` (current CLI package name) |
| SQL migration generator | `drizzle-kit@0.31.10` |
| Migration runner | `drizzle-orm/bun-sql/migrator`, executed by Bun |
| PostgreSQL | 17.10, Alpine x86_64, Docker localhost TCP |
| Image | `postgres@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca` |

The candidate uses stable Drizzle 0.45.2, explicitly included in the adapter's published peer range; it does not require the moving `rc` tag shown by current Drizzle documentation. Pins and transitive integrity hashes are in the [harness lockfile](./better-auth-bun-harness/bun.lock). Package-owner metadata: [Better Auth](https://registry.npmjs.org/better-auth/1.7.5), [adapter](https://registry.npmjs.org/@better-auth/drizzle-adapter/1.7.5), [Drizzle](https://registry.npmjs.org/drizzle-orm/0.45.2), [CLI](https://registry.npmjs.org/auth/1.7.5), [Kit](https://registry.npmjs.org/drizzle-kit/0.31.10).

All JavaScript commands used Bun, including CLI entrypoints with explicit `bun --bun`. The CLI package declares a Node engine in metadata, but its tested operations ran under Bun; no Node runtime fallback was invoked. A parsed-lockfile check confirmed no installed `pg`, `postgres`, or `ioredis` package. Their names can appear in optional peer declarations without being installed. No Redis was used. The existing unrelated Docker services were left untouched.

## Documented support and source inspection

Better Auth documents PostgreSQL through its Drizzle adapter, generated schema plus a separate migration step, and a distinct Relations v2 entrypoint. Drizzle documents supplying an existing Bun `SQL` client. These documents establish the intended interfaces; the runtime evidence below is the compatibility proof for the chosen pins. [Better Auth adapter](https://better-auth.com/docs/adapters/drizzle), [Drizzle Bun SQL](https://orm.drizzle.team/docs/connect-bun-sql), [Bun SQL](https://bun.sh/docs/runtime/sql).

Better Auth MCP was callable. Its adapter, device-authorization and hooks pages were retrieved, including requests specifying 1.7.5. Returned pages did not identify an immutable document snapshot, so implementation claims were checked against installed packages and the release's immutable source commit `5468e6bfcdff799848537cf5ad06ebab15aad9dd`.

- Set `transaction: true` explicitly on `drizzleAdapter`. Its default is false. The enabled path delegates to Drizzle transactions and supplies the transactional adapter to the callback. [Pinned adapter source](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/drizzle-adapter/src/drizzle-adapter.ts).
- Drizzle's Bun driver calls the Bun client's `begin` for transactions and `savepoint` for nested transactions. Its query parameters are passed separately to the Bun driver. [Published pinned driver source](https://unpkg.com/drizzle-orm@0.45.2/bun-sql/session.js).
- Device redemption calls adapter `consumeOne` before creating a new session for the approved user. PostgreSQL consumption uses a deleting query with `RETURNING`, rather than a separate read-then-delete claim. Device/user codes have generated unique indexes. [Pinned device route](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/plugins/device-authorization/routes.ts), [generated schema](./better-auth-bun-harness/schema.ts).

Consumption and later session creation are separate operations in that route. The demonstrated guarantee is at most one successful redemption/session per approved code, not transactional delivery of the response to the desktop. A crash after consumption or a lost successful response may require a new approval flow; this research did not simulate those failures. Do not promise retrying the same code will return the issued token.

## Actual runtime evidence

The [integration harness](./better-auth-bun-harness/validation.test.ts) invokes the real Better Auth Fetch handler with HTTP-shaped Requests and cookie/bearer headers, backed by live PostgreSQL over TCP. It does not mock the adapter or database. It does not run a network HTTP listener, browser, Next.js route or Tauri process.

| Check | Observed outcome |
| --- | --- |
| Bun CLI schema generation | Generated all five tables: user, account, session, verification, device_code, including device-code unique indexes |
| SQL generation | Pinned Drizzle Kit generated migration SQL under Bun |
| Migration apply/reapply | Bun-native migration runner applied successfully; a second application succeeded without reapplying schema changes |
| Account CRUD | Email/password signup created user, account and session; adapter reads/updates succeeded; deleting user cascaded account/session deletion |
| Adapter transactions | Commit persisted an account update; deliberate exception rolled back both a user update and account deletion |
| Independent desktop session | Cookie-authenticated browser verified and approved the code; redemption created a distinct session ID/token for the same user |
| Rolling inactivity | Aging the stored expiry then using the bearer session moved expiry to approximately request time plus 30 days, verified in PostgreSQL and response |
| Expiry | A session whose stored expiry was in the past returned no authenticated session |
| Revocation | Browser revoked the desktop session; its bearer stopped authenticating while the browser remained valid |
| One-use contention | Five codes, each redeemed by 20 concurrent requests: exactly one success and one new session per code; losers returned invalid_grant or slow_down; subsequent reuse failed |
| Negative device flow | Pending code, denial, expiry, unknown client and approval from a different browser account failed as expected |
| Bearer copying | Two requests with the same bearer credential authenticated the same session; invalid bearer returned no session |
| Fresh-auth gap | Browser session aged eleven minutes failed unlink with SESSION_NOT_FRESH; it could still approve a desktop whose newly created session successfully unlinked the research account |

Final command result: **5 tests passed, 0 failed, 145 assertions**. This includes a passing reproduction of a missing product guarantee; it is not a claim that the fresh-auth requirement passed. The preceding migration script printed `PASS migrations applied twice through Bun SQL`. Formatting/lint checks cover only the changed research files.

The harness disables email verification and rate limiting to isolate storage/session behavior and uses localhost-only, explicitly disposable credentials. These settings are not production recommendations. The invented linked-provider record in the freshness test is created through the adapter; no live social-provider authentication occurred.

## Session contract implications

Use a database-backed session with `expiresIn: 2592000`, `updateAge: 0`, cookie caching disabled, and no secondary storage for the demonstrated strict rolling inactivity behavior. Renewal updates database expiry without rotating the opaque token or resetting session creation time. Each protected REST request must actually validate/renew the session. Disabling refresh, deferring it without performing the follow-up, trusting a cached user, or validating only a cookie's presence does not provide this guarantee. Browser responses must preserve renewed cookies. These are integration requirements, not implemented application routes. [Pinned session implementation](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/api/routes/session.ts), [session documentation](https://better-auth.com/docs/concepts/session-management).

The desktop polls with its device code and client ID. The signed-in browser first claims the user code, then explicitly approves it. Successful redemption returns `access_token`, which is the new Better Auth session token; it is independent of the approving browser token. Use it in the Authorization bearer header. The tested configuration uses `bearer()` with its default acceptance of raw tokens; switching on `requireSignature` changes this issuance contract. [Device authorization](https://better-auth.com/docs/plugins/device-authorization), [pinned bearer implementation](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/plugins/bearer/index.ts).

The session credential is reusable until expired or revoked. A copied/stolen bearer is indistinguishable from the legitimate holder in this configuration and can itself keep the session active. One-use device-code protection does not make session tokens one-use or hardware-bound. Independent sessions allow targeted revocation; TLS, native credential protection and keeping credentials out of UI code remain implementation responsibilities. No token is printed by the harness on successful runs.

## Concrete fresh-auth remedy to carry into the design

`freshAge: 600` checks session creation time. It neither records the last credential verification nor establishes that creating a desktop session was new authentication. The runtime reproduction confirms this distinction for the built-in unlink endpoint. [Freshness predicate](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/api/routes/session.ts), [unlink guard](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/api/routes/account.ts).

Recommended application design, not implemented here:

1. Complete sensitive login-method changes, email changes and account deletion in the system browser. Require an explicit reauthentication step there; an existing login cookie or newly approved desktop session does not satisfy it.
2. Persist a server-owned reauthentication record bound to instance, immutable account ID and the resulting browser session. Set its timestamp only after a successful credential verification or a verified provider reauthentication roundtrip for that same account. Reject account switching during this operation. Never set it merely when any session is created, refreshed or device-approved.
3. Require that record to be younger than ten minutes at every sensitive endpoint, including direct Better Auth paths and any app wrapper. Reject desktop bearer requests to those browser-only operations. Clear/expire the record on revocation/sign-out and apply normal CSRF protections.
4. For email/password, a successful explicit password sign-in is an available credential-verification path. For social methods, validate the selected provider's reauthentication semantics; a silent provider callback by itself must not be labeled fresh credential verification. If a provider cannot establish the required proof, use a verified recovery/credential path rather than silently accepting the existing session.

Better Auth supports before hooks that reject endpoints, after hooks that inspect endpoint outcomes/new sessions, and password verification through auth context. These are concrete extension seams for the guard and marker; the hook must filter verified reauthentication paths, not every `newSession`. No complete first-party cross-provider reauthentication contract was established by this research. [Hooks documentation](https://better-auth.com/docs/concepts/hooks), [pinned credential sign-in route](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/api/routes/sign-in.ts).

## Reproduce

Use the isolated `docs/research/better-auth-bun-harness` directory with Bun 1.4.2 and Docker. The example creates a fresh disposable container using the tested image digest and only exposes it on localhost. The credential in this example is intentionally public test data.

```powershell
docker run --detach --rm --name pr0-auth-validation-13 --publish 127.0.0.1:55413:5432 --env POSTGRES_USER=pr0_validation --env POSTGRES_PASSWORD=throwaway-validation-only --env POSTGRES_DB=pr0_validation postgres@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca
bun install --frozen-lockfile --ignore-scripts
bun --bun node_modules/auth/dist/index.mjs generate --config ./auth.ts --output ./schema.ts --yes
bun --bun node_modules/drizzle-kit/bin.cjs generate
bun --bun run migrate.ts
bun --bun test validation.test.ts
docker stop pr0-auth-validation-13
```

Wait for PostgreSQL readiness before the migration command (`docker exec pr0-auth-validation-13 pg_isready --username pr0_validation --dbname pr0_validation`). On the initial bootstrap an empty schema placeholder produced a missing-table diagnostic before the generator successfully replaced it; the committed generated schema avoids that bootstrap state. The checked-in migration is sufficient for rerunning tests; regeneration checks generator compatibility and should produce no new migration when unchanged.

The Docker container is disposable and has no named volume. Cleanup stops only the explicitly named research container, never an existing application's database. Package scripts and app manifests are unchanged.

## Remaining implementation and release gates

There is no missing environment prerequisite for this backend compatibility result. Recommend the exact stable adapter chain above, explicit transactions and the renewal configuration for the design, while retaining the fresh-auth extension as an explicit application requirement.

Before release, implement and verify the fresh-auth marker/guards; real Google/GitHub login, provider linking and verified-email enforcement; password-reset session revocation; Next.js response-cookie propagation and REST authorization; HTTPS/proxy/rate-limit configuration; Tauri browser approval, cancellation, credential protection and transport; account/instance isolation and deletion-confirmation behavior; and Linux/Bun server deployment plus backup/restore and upgrade migration procedures. None of those were validated by this isolated backend harness. Re-run compatibility checks when any pinned component changes.

## Follow-up: a concrete email challenge for fresh authentication

This follow-up investigates a provider-independent option for users who have only social login, while preserving the requirement to reauthenticate explicitly in the browser. It is a proposed mechanism for the driving developer to accept, not a newly selected login method. The account decision already permits recovery through the verified account email.

### What the pinned Email OTP plugin actually supplies

The same Better Auth 1.7.5 package exports `emailOTP`. Its defaults are six numeric digits, a 300-second lifetime and three allowed failed attempts. `storeOTP` defaults to plaintext; the follow-up harness selects `"hashed"` explicitly. The plugin defines per-endpoint rate limits of three requests per sixty seconds, but these are not a persistent per-account abuse policy, and the harness disables rate limiting to isolate database behavior. [Official Email OTP documentation](https://better-auth.com/docs/plugins/email-otp), [pinned defaults and limiters](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/plugins/email-otp/index.ts).

`/email-otp/check-verification-otp` checks the stored code without consuming it on success. It must never mint a one-use fresh-authentication proof. `/email-otp/verify-email` and `/sign-in/email-otp` call `atomicVerifyOTP`, which consumes the verification record, checks its attempt budget and verifies the stored digest. Wrong attempts recreate the record with the original expiry and incremented count. After three wrong attempts, the next attempt is rejected and the record stays consumed. Expired records cannot be redeemed. OTP expiry and rate limiting are separate controls. [Pinned route/helper implementation](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/plugins/email-otp/routes.ts), [pinned atomic verification storage](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/db/internal-adapter.ts).

The plugin's identifier is `type + "-otp-" + lowercaseEmail`. It contains no initiating browser session, immutable account ID, purpose-specific reauthentication challenge, or email revision. The public verification endpoint does not require the initiating browser cookie. Therefore a successful plugin response proves possession of that email OTP; it does not prove possession of the browser session to which pr0 must grant fresh-authentication authority. Its non-consuming check path also updates failed-attempt state using read/update logic rather than the consuming path, so exposing that path is not an appropriate way to implement a strict concurrent attempt budget for reauthentication. [Pinned identifier implementation](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/plugins/email-otp/utils.ts), [pinned route implementation](https://github.com/better-auth/better-auth/blob/5468e6bfcdff799848537cf5ad06ebab15aad9dd/packages/better-auth/src/plugins/email-otp/routes.ts).

### Additional runtime evidence

A fixture with a verified email and a synthetic social-provider account without a password exercised the real plugin against PostgreSQL. The send callback captured mail in memory; no email was sent externally.

- The stored value did not contain the delivered code, and stored expiry was approximately five minutes ahead.
- Five concurrent calls to the non-consuming check endpoint all accepted the same valid OTP.
- Twenty concurrent consuming verification calls without browser cookies produced exactly one success. Reusing that OTP failed.
- An explicitly expired OTP failed. After three wrong codes, the correct code failed with `403 TOO_MANY_ATTEMPTS`.
- A separate adapter-primitive test stored a namespaced verification record bound to an instance, immutable account ID, browser session ID and email revision. `consumeOne` additionally matched challenge ID, HMAC digest and future expiry. Wrong binding and wrong proof consumed nothing, one of twenty concurrent valid claims succeeded, replay failed and an expired record could not be claimed.

The full extended suite passes **7 tests, 165 assertions, zero failures**. The final test proves the scoped atomic consumption primitive, not a complete challenge service. It does not implement delivery, issuance serialization, an attempt counter, reauthentication-marker creation or endpoint guards. Earlier backend and fresh-age findings remain unchanged.

### Recommended concrete application mechanism

Prefer a small, dedicated browser reauthentication challenge over exposing generic OTP login or treating email verification as automatically fresh authentication. This avoids making a new general login method merely to support sensitive actions.

1. An authenticated browser explicitly requests reauthentication. Resolve the account and its already-verified current email from the server session, never from a submitted target email. Reject bearer-only requests, apply CSRF/origin checks and verify that the account/session remain active.
2. Create a cryptographically random challenge ID and an eight-digit cryptographically random email code, with a five-minute TTL and at most three failed verification attempts. Persist a purpose-specific row containing instance/account/browser-session IDs, the current email or email revision, a keyed digest of challenge ID plus code, expiry and attempt count. Keep the HMAC key server-only. Serialize issuance per account, invalidate the preceding outstanding reauth challenge when resending, and do not extend an existing challenge's TTL. Suggested separate send controls: one send per sixty seconds and three per fifteen minutes per account, with an additional deployment-defined IP limit. These numeric controls are proposed defaults, not plugin behavior or accepted product decisions.
3. Verification requires the same live browser session, challenge ID and code. In one PostgreSQL transaction, lock the challenge row; check binding, purpose, account status, unchanged verified email, expiry against the current database clock and remaining attempts. A wrong code increments the failed-attempt counter and commits that failure without issuing proof. This serialization prevents parallel guesses from exceeding the budget. Three failures invalidate the challenge. Do not roll back the failed-attempt update merely because the API returns an error.
4. On success, atomically consume the challenge and persist a server-owned reauthentication marker bound to the current browser session/account, with verification time and a ten-minute expiry. The demonstrated adapter `consumeOne` can provide the one-use claim inside the transaction; a dedicated challenge table supplies the typed attempt/binding fields absent from the generic verification table. A lost success response can read the already-issued marker in that same browser session; it must not reissue authority by replaying the code.
5. Every sensitive endpoint checks that live session and marker, including direct Better Auth account routes. Device approval/session creation cannot mint or inherit this marker. A different account/session, changed email, expired challenge, exhausted attempts, replay, revoked session or deleted account yields no marker. Invalidate markers on sign-out/revocation and email change; keep normal session validation on each sensitive request. The marker is not a bearer credential exposed to the desktop renderer.

The plugin remains a possible implementation component only behind equivalent app guards: bind a separate challenge before issuance, prevent caller-selected email/account changes, consume through the verifying endpoint rather than the check endpoint, reject unbound direct calls, and atomically gate marker issuance. Its email-only identifier and generic public routes make that composition more delicate than the dedicated challenge above. The custom approach uses already-validated Bun SQL transactions and scoped adapter consumption without relying on provider-specific forced-login semantics. The SQL attempt counter and complete HTTP guard/marker flow still require implementation tests; they are concrete implementation work, not an unresolved external compatibility dependency.
