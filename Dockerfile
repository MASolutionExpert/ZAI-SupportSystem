# syntax=docker/dockerfile:1

# =============================================================================
# Support Desk — production image (multi-stage)
#
#  deps      : bun installs ALL dependencies (dev deps are required for the
#              Next.js build) + generates the Prisma client. Cached while
#              package.json / bun.lock do not change.
#  build     : bun compiles the Next.js app -> .next, including the standalone
#              server bundle (server.js + traced runtime + static/public).
#  prod-deps : bun installs PRODUCTION dependencies only (next, @prisma/client,
#              prisma CLI, bcryptjs, zod, ...) and generates the Prisma client
#              against exactly those versions (so the runtime node_modules is
#              self-consistent, including Prisma engine binaries).
#  runtime   : node:22-bookworm-slim, non-root user "node", openssl + tini
#              only, persistent storage dir pre-created with safe ownership,
#              standalone server (node server.js), HEALTHCHECK via node's
#              built-in fetch against /api/health. The database and cache run
#              as separate containers (docker-compose.yml: postgres:16 +
#              redis:7) — this image is stateless except for /app/storage.
#
#  Security posture:
#   - runs as non-root (uid 1000), no privileged mode, no Docker socket
#   - no secrets baked into the image (all configuration arrives at runtime)
#   - safe behind a reverse proxy (the app trusts x-forwarded-proto)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — deps: full dependency install + Prisma client generation
# -----------------------------------------------------------------------------
FROM oven/bun:1 AS deps
WORKDIR /app

# Manifests first for optimal layer caching, plus the Prisma schema so the
# client (and its engine binaries) can be generated right after install.
COPY package.json bun.lock ./
COPY prisma ./prisma

RUN bun install --frozen-lockfile
RUN bunx prisma generate

# -----------------------------------------------------------------------------
# Stage 2 — build: compile the Next.js application with Bun
# -----------------------------------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

# Reuse the cached full dependency tree from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Application source + tooling configs required by `next build`.
COPY package.json bun.lock next.config.ts tsconfig.json postcss.config.mjs \
     tailwind.config.ts components.json eslint.config.mjs ./
COPY src ./src
COPY public ./public
COPY prisma ./prisma

ENV NEXT_TELEMETRY_DISABLED=1

# Runs: next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 3 — prod-deps: production dependencies only + matching Prisma client
# -----------------------------------------------------------------------------
FROM oven/bun:1 AS prod-deps
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma ./prisma

RUN bun install --production --frozen-lockfile

# Generate the client against the *production* dependency versions so that
# node_modules is complete and self-consistent at runtime (client + engines).
RUN bunx prisma generate

# -----------------------------------------------------------------------------
# Stage 4 — runtime: minimal Node 22 server, non-root
# -----------------------------------------------------------------------------
FROM node:25-bookworm-slim AS runtime

# openssl is required by Prisma; tini gives us correct PID-1 signal handling
# and zombie reaping. Nothing else is installed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Pre-create the persistent storage directory owned by uid 1000 ("node") so
# that the named Docker volume inherits safe ownership when first mounted.
# The database is a separate container (postgres:16) with its own volume.
RUN mkdir -p /app/storage && chown -R node:node /app/storage

# Production dependency tree (includes the generated Prisma client/engines).
# Copied AFTER the standalone bundle below so the full, self-consistent
# production module set wins — it also provides the Prisma CLI used by the
# entrypoint for `prisma migrate deploy`.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# Standalone server bundle (server.js + traced runtime + .next/static + public
# — the build script already assembles static/public into the standalone dir).
COPY --from=build --chown=node:node /app/.next/standalone ./

# Static assets, Prisma migrations/schema, management scripts and manifests.
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node package.json next.config.ts tsconfig.json VERSION ./

# Belt-and-braces: keep the entrypoint executable even on filesystems that do
# not preserve the chmod bit of the build context.
RUN chmod +x /app/scripts/docker-entrypoint.sh

USER node
EXPOSE 3000

# Container-native healthcheck: node 22 ships a global `fetch`.
# GET /api/health -> 200 {"status":"ok",...} when healthy, 503 when the
# database is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Entrypoint: waits for PostgreSQL, then optional `prisma migrate deploy`
# (MIGRATE_ON_STARTUP), then execs the default CMD below. Override CMD to run
# a different command.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/docker-entrypoint.sh"]

# Production server: the standalone Next.js server (official production
# pattern for output: "standalone"). server.js honors $PORT (default 3000).
CMD ["node", "server.js"]
