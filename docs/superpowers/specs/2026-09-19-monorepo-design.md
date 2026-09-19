# Web and desktop foundation

Use Bun 1.4.2 workspaces and Turborepo. Keep Next.js 16.3.5 and React 19.2.8 from the starter. The existing uncommitted shadcn and Ultracite setup belongs to the user and is part of the migration.

## Boundaries

- `apps/web`: Next.js App Router, web entry point, REST Route Handlers under `/api/v1`, public OpenAPI JSON at `/api/openapi.json`, Swagger UI at `/docs`.
- `apps/desktop`: Tauri 2 with a Vite/React frontend. It bundles local frontend assets and calls the hosted web API. It does not embed a Next.js server.
- `packages/ui`: shared shadcn components, theme, utilities, and a minimal starter screen. No Next.js imports, native APIs, or server data fetching.
- `packages/api-contract`: Zod request/response contracts and OpenAPI 3.1 generation. One health endpoint proves the initial integration; no domain logic.
- `packages/api-client`: fetch client with runtime response validation, typed errors and cancellation, TanStack Query options and provider. Both applications use the same REST interface.
- `packages/typescript-config`: common strict TypeScript configuration.

The user selected Next.js Route Handlers over a separate API service. Keeping contracts independent permits later extraction. A Vite frontend is preferable to a second statically exported Next.js application because the desktop shell does not need Next.js routing or server features.

## Data flow

Each application creates a Query provider with its API base URL. Web requests use the same origin. Desktop development defaults to `http://localhost:3000`; production builds require an explicit HTTPS `VITE_API_BASE_URL`. Query cache keys include the API URL. REST responses are validated against the same schemas used to document the API. Non-success responses produce typed HTTP errors; invalid payloads fail visibly. Cancellation flows through to fetch.

The public health endpoint is `GET /api/v1/health`. CORS uses an explicit origin allowlist including Tauri origins and the local Vite origin in development. No authentication mechanism is invented at this stage. Authentication, authorization, CSRF policy and desktop credentials will be designed with the first protected feature. Server Actions are not the shared data interface. TanStack Store is deferred until non-server shared state requires it.

## Tooling and verification

Root commands coordinate development, builds, types, tests and linting. Native desktop builds remain separate from frontend builds so web contributors do not need Rust. Shared packages expose source entry points without barrel files. Tailwind scans shared UI source in both applications, and shadcn aliases install components into the shared package.

Verify dependency installation, formatting/lint, all workspace types, meaningful HTTP client and CORS tests, both frontend builds, live API/OpenAPI/docs responses, React diagnostics, and Rust compilation when the native toolchain is available. Document any platform limitations precisely.
