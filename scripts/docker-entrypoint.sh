#!/bin/sh
# =============================================================================
# Support Desk — Docker entrypoint (POSIX sh, runs as user "node")
#
# Responsibilities:
#   1. Validate required environment (fail LOUDLY, never print secret values).
#   2. Apply pending versioned database migrations via
#      `prisma migrate deploy` — safe and idempotent: applies PENDING
#      migrations only, never resets, and creates the SQLite file if missing.
#      Controlled by MIGRATE_ON_STARTUP (default true; set "false" to manage
#      migrations manually).
#   3. Exec the application (default CMD: `next start` via node, port ${PORT}).
# =============================================================================
set -eu

echo "[entrypoint] Support Desk container starting..."

# -----------------------------------------------------------------------------
# 1. Required environment
# -----------------------------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ]; then
  cat >&2 <<'ERR'

================================================================
ERROR: DATABASE_URL is not set.

The application refuses to start without a database location.
Provide it in your .env file (loaded via docker-compose "env_file"),
for example:

    DATABASE_URL=file:/app/db/supportdesk.db

Fix the configuration and start the container again.
================================================================

ERR
  exit 1
fi

# Note: only the PRESENCE of variables is validated/echoed here — secret
# values (AUTH_SECRET, APP_ENCRYPTION_KEY, SUPERADMIN_PASSWORD) are never
# printed by this script.

# -----------------------------------------------------------------------------
# 2. Database migrations (safe: deploy pending only, never resets)
# -----------------------------------------------------------------------------
if [ "${MIGRATE_ON_STARTUP:-true}" != "false" ]; then
  echo "[entrypoint] Applying pending database migrations (prisma migrate deploy)..."
  node node_modules/.bin/prisma migrate deploy
  echo "[entrypoint] Database migrations are up to date."
else
  echo "[entrypoint] MIGRATE_ON_STARTUP=false — skipping automatic migrations (manage them manually with: node node_modules/.bin/prisma migrate deploy)."
fi

# -----------------------------------------------------------------------------
# 3. Start the application
# -----------------------------------------------------------------------------
# If no command override was provided (i.e. no CMD arguments reached us),
# default to the standalone Next.js server, honoring $PORT (default 3000).
if [ "${1:-}" = "" ]; then
  set -- node server.js
fi

echo "[entrypoint] Starting Support Desk on port ${PORT:-3000}..."
exec "$@"
