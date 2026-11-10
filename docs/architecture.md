# Architecture conventions

- `apps/web` owns Next.js routing and REST Route Handlers. Read its installed Next.js guides in `apps/web/node_modules/next/dist/docs/` before changing framework-specific code.
- `apps/desktop` owns Vite, Tauri and native integration. It consumes the hosted API; it does not run a Next.js server.
- `packages/ui` owns reusable UI and the shadcn theme. Keep platform routing, native APIs and data fetching outside it.
- `packages/api-contract` owns Zod schemas and the public OpenAPI document. Update schemas, route implementations and documentation together.
- `packages/api-client` owns validated fetch requests and TanStack Query integration. Use REST for data and mutations shared by web and desktop. Do not introduce Server Actions for shared application flows.
- TanStack Query owns server state. Add TanStack Store only when a concrete client state requirement needs it.
- Bun is the only supported JavaScript/TypeScript runtime for development and production servers, tooling and tests. Use explicit `bun --bun` CLI entry points and the root `bunfig.toml` default; do not introduce Node.js fallback paths or Node-only/Edge deployment targets. Tauri still uses Rust and the system WebView at runtime.
- Prefer Bun-native APIs where appropriate. Future PostgreSQL clients use `SQL`/`sql` from `bun`, parameterized tagged templates, connection pooling and transactions. Use `RedisClient`/`redis` from `bun` if Redis becomes necessary. Keep both behind server-only modules; never expose connections or credentials to the shared UI or desktop frontend. No database/cache infrastructure is introduced before a feature needs it.
- Root tooling uses Bun and Turborepo. Install workspace dependencies in the workspace that uses them. Keep reusable code in packages and application entry points in apps. Node-compatible imports/types may be used under Bun; they do not require a Node.js runtime.
- `infrastructure/update-channel` owns release-image packaging under Bun and the independent static Nginx update host. Release files live in the image; the channel does not consume instance credentials or data services.
- `infrastructure/ingress` is an optional example nginx ingress that supplies the authenticated client-attribution headers behind an edge proxy. It holds nginx configuration, its entrypoint and a Dockerfile; it has no workspace package. Compose and the hosted redeploy script build its image. The application never requires it.
- `infrastructure/hosted` (`@pr0/hosted`) owns the hosted Compose example and the redeploy script for the official service. It runs under Bun on the app host and drives Docker Compose; it never imports application server code.
- `infrastructure/probe-host` (`@pr0/probe-host`) owns the external availability probe, alert rules and alert delivery. It runs on a separate host and reads the service only through its public HTTP API and the availability script.
- Shared contracts between apps and infrastructure, such as the availability sample and operator command output, live in `packages/api-contract`. Infrastructure workspaces may depend on `packages/*`, but never on `apps/*` source.
- Test HTTP failures, invalid payloads and cancellation when adding API client methods. Document and validate request inputs at the server boundary. CORS is not authentication.

See the root README for commands, environment variables and build prerequisites.
