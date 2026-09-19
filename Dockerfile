FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS base

FROM base AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Install from workspace manifests first so source changes reuse this layer.
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN bun install --frozen-lockfile

COPY apps/web ./apps/web
COPY packages ./packages
RUN bun run --cwd apps/web build

FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=bun:bun /app/apps/web/.next/standalone ./
COPY --from=build --chown=bun:bun /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=bun:bun /app/apps/web/public ./apps/web/public

USER bun
EXPOSE 3000
CMD ["bun", "--bun", "apps/web/server.js"]
