# pr0

Bun + Turborepo foundation for a Next.js web app and a Tauri desktop app. Both render the same shared UI and call the same REST API through TanStack Query.

For the agreed product behavior, canonical decisions and outstanding readiness confirmation, see the [MVP specification handoff](docs/specs/mvp-readiness.md).

## Workspaces

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | Next.js 16 App Router, REST Route Handlers, Swagger UI |
| `apps/desktop` | Vite + React frontend and Tauri 2 native shell |
| `packages/ui` | shadcn components, shared screens, utilities and Tailwind theme |
| `packages/api-contract` | Zod schemas, inferred types and OpenAPI 3.1 document |
| `packages/api-client` | Validated fetch client, TanStack Query options and provider |
| `packages/typescript-config` | Shared strict TypeScript configuration |

Shared packages export source files through explicit package subpaths. Next.js and Vite compile those sources; no separate package build step is needed. Shared UI must stay independent of Next.js, Tauri and server modules.

## Development

Install [Bun 1.4.2](https://bun.sh/), then run from the repository root:

```sh
bun install
bun run dev
```

This starts the web/API at `http://localhost:3000` and the desktop frontend at `http://localhost:1420`. The latter is useful for browser development without Rust. Both show a minimal shared starter screen with an API connection check.

For a native desktop window, keep the web/API running and start Tauri in another terminal:

```sh
bun run dev:web
# In another terminal:
bun run dev:desktop
```

Tauri starts its Vite server automatically. Stop the browser-only `bun run dev` session first to free port 1420. Native builds require Rust 1.94+ and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) (on Windows: Microsoft C++ Build Tools and WebView2).

## Runtime and native Bun APIs

Bun is the only supported JavaScript runtime for development, production servers, scripts and tests. JavaScript CLI scripts explicitly use `bun --bun`; `bunfig.toml` also makes Bun the default for scripts with Node shebangs. Next.js configuration rejects a non-Bun process. A separate Node.js installation is not required. Node-compatible imports and `@types/node` remain valid for framework/tool compatibility under Bun.

Use Bun-native APIs where they fit: `Bun.file`/`Bun.write` for file I/O, Bun's test runner, and built-in SQL/Redis clients for future backend work. PostgreSQL will use [`SQL`/`sql` from `bun`](https://bun.com/docs/runtime/sql), parameterized tagged templates, pooled connections and transactions. If Redis is needed, use [`RedisClient`/`redis` from `bun`](https://bun.com/docs/runtime/redis). Database/cache services, credentials and drivers are not added until a feature requires them.

Keep these APIs and connection credentials in server-only modules; shared UI and desktop/browser code use REST. Production hosting must execute the web server with Bun using `bun run start`; a Node-only or Edge runtime is not a supported deployment target. `PORT` controls the production port (3000 by default). Tauri's shipped runtime remains Rust plus the system WebView, with Bun handling its JavaScript tooling.

## API and data fetching

- `GET /api/v1/health`: minimal availability check; no downstream service checks.
- `GET /api/openapi.json`: public OpenAPI 3.1 JSON, generated from shared schemas.
- `/docs`: public interactive Swagger UI, with a working Try it out flow.

Swagger assets are served locally from the official prebuilt distribution. The web development/build scripts prepare them automatically, avoiding a Swagger OpenAPI 3.1 resolver incompatibility with Turbopack. The generated files are cached as web build outputs and are not committed.

Add request/response schemas to `packages/api-contract`, register the route in its OpenAPI document, implement the corresponding Next.js Route Handler, then add a validated client method and Query options to `packages/api-client`. Keep database access and secrets inside the server application. Update the API contract and implementation together.

The web client uses same-origin requests. Desktop development defaults to `http://localhost:3000`; set `VITE_API_BASE_URL` to change that origin. Query cache keys include the origin, cancellation is forwarded to fetch, and HTTP errors remain typed. Each provider owns its QueryClient; remount the provider to change API origins.

Use REST for data shared by both applications. Keep Server Actions for a future genuinely web-only need. TanStack Query owns server state. Add TanStack Store only when shared client-only state warrants it.

Tauri origins are explicitly allowed by the API's CORS helper. Local Vite origins are allowed in development. Set `API_ALLOWED_ORIGINS` in `apps/web/.env.local` for additional comma-separated browser origins. CORS is a browser policy, not authentication. Protected endpoints, credentials and authorization are deferred until their requirements exist. Extend the CORS method list when adding write endpoints.

## Building

Desktop production builds require an explicit HTTPS API origin so a shipped application never silently points at localhost. Copy `apps/desktop/.env.example` to `.env.local` and set:

```dotenv
VITE_API_BASE_URL=https://your-api.example.com
```

Vite embeds this public URL at build time. It must point to the deployed Next.js host; it is not a secret. Tauri CSP permits HTTPS API connections. Development CSP also permits the local API and Vite servers; update `devCsp` in `tauri.conf.json` if using a custom HTTP development origin.

```sh
bun run build           # Next.js production build and desktop frontend assets
bun run build:desktop   # Native application and OS-specific installers
bun run start           # Serve the built Next.js app
```

For only the web app: `bun x --bun turbo run build --filter=@pr0/web`.

The Tauri application identifier is currently `com.umami-creative.pr0`; confirm it before the first distributed release. The native capability set is empty until a feature needs native commands. Installer signing, auto-updates and release publishing are outside this foundation.

## Docker Compose

On a machine with Docker running Linux containers and Docker Compose, run from the repository root:

```sh
docker compose up --build -d
```

Open `http://localhost:3000` (or your server's address). The image builds the web/API with Bun and includes its runtime; the host needs neither Bun nor Node.js. No hosting provider, domain, reverse proxy, or external account is required to start the current app. Docker selects the base image for the build architecture; no host platform is hard-coded in Compose.

Optionally copy the root `.env.example` to `.env` to change `PR0_PORT`, `PR0_BIND_ADDRESS`, or `API_ALLOWED_ORIGINS`. For a reverse proxy running on the same host, set `PR0_BIND_ADDRESS=127.0.0.1`. A containerized proxy can instead join the Compose network and reach `web:3000`. Use your preferred proxy and HTTPS setup for internet-facing operation; the Compose file does not manage DNS or certificates.

```sh
docker compose ps             # Includes the web/API health check
docker compose logs -f web
docker compose up --build -d  # Rebuild after updating the source checkout
docker compose down          # Stop and remove the containers
```

This runs the current starter UI, health API, OpenAPI endpoint, and Swagger docs. Accounts, prompt persistence, synchronization, and their PostgreSQL/search services are still future application work, so this setup has no application data volumes yet. Desktop installers are built separately. The [deployment specification](docs/specs/deployment-self-hosting.md) describes how Compose must grow as those features are implemented, with hosting choices left to each operator.

## Shared UI

Run shadcn from the web workspace:

```sh
cd apps/web
bun x --bun shadcn add input
```

The workspace aliases route primitives to `packages/ui`. Import them as `@pr0/ui/components/button` and utilities as `@pr0/ui/lib/utils`. Both apps import `@pr0/ui/globals.css`; its explicit Tailwind source registration includes the shared components. Theme tokens are defined once in the UI package.

Keep platform routing and native integrations in each app. Shared screens receive data and callbacks through props. The initial screen demonstrates this without adding domain logic.

## Checks

```sh
bun run check
bun run fix
bun run typecheck
bun run test
bun run build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
```

Ultracite/Oxlint/Oxfmt configuration stays at the root. Tests use Bun's built-in runner. The narrow lint exceptions for the generated shadcn button preserve its standard component/variant exports and theme calculations. Native binaries, frontend output, caches, local environments and generated Tauri schemas are ignored. Commit both `bun.lock` and the desktop `Cargo.lock`.
