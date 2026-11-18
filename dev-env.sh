#!/usr/bin/env sh
# =============================================================================
# Local development environment (non-Docker runs) — mirrors the constants in
# scripts/dev-postgres.ts (the embedded PostgreSQL provisioner).
#
# Usage:
#   source dev-env.sh && bun run dev          # dev server + embedded postgres
#   source dev-env.sh && bun run db:deploy    # apply migrations
#   source dev-env.sh && bun run seed-demo    # demo data
#
# Why this exists:
#   Shell environment variables take precedence over .env files in every
#   runtime (Bun, Prisma CLI, Next.js). Machines that export a stale or
#   foreign DATABASE_URL globally (CI runners, sandboxes, dotfiles) would
#   otherwise silently redirect migrations and queries away from the local
#   dev database. Sourcing this file pins the URL explicitly and dev-only.
#
# Never used in production: Docker deployments build DATABASE_URL from
# POSTGRES_* variables inside docker-compose.yml (see DEPLOYMENT.md).
# =============================================================================
export DEV_PG_HOST="${DEV_PG_HOST:-127.0.0.1}"
export DEV_PG_PORT="${DEV_PG_PORT:-5433}"
export DEV_PG_USER="${DEV_PG_USER:-supportdesk}"
export DEV_PG_PASSWORD="${DEV_PG_PASSWORD:-supportdesk}"
export DEV_PG_DBNAME="${DEV_PG_DBNAME:-supportdesk}"
export DATABASE_URL="postgresql://${DEV_PG_USER}:${DEV_PG_PASSWORD}@${DEV_PG_HOST}:${DEV_PG_PORT}/${DEV_PG_DBNAME}?schema=public"
