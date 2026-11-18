#!/bin/sh
# =============================================================================
# ZAI Support System — Docker entrypoint (POSIX sh, runs as user "node")
#
# Responsibilities:
#   1. Validate required environment (fail LOUDLY, never print secret values).
#   2. Wait for PostgreSQL to accept connections (bounded retry loop —
#      belt-and-braces on top of the compose `service_healthy` dependency).
#   3. Apply pending versioned database migrations via
#      `prisma migrate deploy` — safe and idempotent: applies PENDING
#      migrations only, never resets data. Controlled by MIGRATE_ON_STARTUP
#      (default true; set "false" to manage migrations manually).
#   4. Exec the application (default CMD: standalone node server, port ${PORT}).
# =============================================================================
set -eu

echo "[entrypoint] ZAI Support System container starting..."

# -----------------------------------------------------------------------------
# 1. Required environment
# -----------------------------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ]; then
  cat >&2 <<'ERR'

================================================================
ERROR: DATABASE_URL is not set.

With docker-compose.yml this is built automatically from the
POSTGRES_* variables in .env. If you run the container standalone,
provide the URL explicitly, for example:

    DATABASE_URL=postgresql://supportdesk:<password>@db:5432/supportdesk?schema=public

Fix the configuration and start the container again.
================================================================

ERR
  exit 1
fi

case "${DATABASE_URL}" in
  postgresql://*|postgres://*) ;;
  *)
    cat >&2 <<'ERR'

================================================================
ERROR: DATABASE_URL is not a PostgreSQL URL.

Since v0.10.0 the application runs on PostgreSQL (Prisma ORM).
Expected scheme:

    postgresql://<user>:<password>@<host>:5432/<database>

With docker-compose.yml this value is built automatically — do not
set DATABASE_URL manually in .env there.
================================================================

ERR
    exit 1
    ;;
esac

# Note: only the PRESENCE of variables is validated/echoed here — secret
# values (AUTH_SECRET, APP_ENCRYPTION_KEY, SUPERADMIN_PASSWORD,
# POSTGRES_PASSWORD) are never printed by this script.

# -----------------------------------------------------------------------------
# 2. Wait for PostgreSQL (bounded — compose healthchecks gate this already)
# -----------------------------------------------------------------------------
DB_WAIT_SECONDS="${DB_WAIT_SECONDS:-60}"
echo "[entrypoint] Waiting for PostgreSQL (up to ${DB_WAIT_SECONDS}s)..."
i=0
while ! node node_modules/.bin/prisma migrate status >/dev/null 2>&1; do
  i=$((i + 2))
  if [ "$i" -ge "$DB_WAIT_SECONDS" ]; then
    cat >&2 <<'ERR'

================================================================
ERROR: PostgreSQL is not reachable (timeout).

Check the database container and credentials:
    docker compose ps
    docker compose logs db
The app will exit now; compose restart policy will retry on
`restart: unless-stopped`.
================================================================

ERR
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] PostgreSQL is reachable."

# -----------------------------------------------------------------------------
# 3. Database migrations (safe: deploy pending only, never resets)
# -----------------------------------------------------------------------------
if [ "${MIGRATE_ON_STARTUP:-true}" != "false" ]; then
  echo "[entrypoint] Applying pending database migrations (prisma migrate deploy)..."
  node node_modules/.bin/prisma migrate deploy
  echo "[entrypoint] Database migrations are up to date."
else
  echo "[entrypoint] MIGRATE_ON_STARTUP=false — skipping automatic migrations (manage them manually with: node node_modules/.bin/prisma migrate deploy)."
fi

# -----------------------------------------------------------------------------
# 4. Start the application
# -----------------------------------------------------------------------------
# If no command override was provided (i.e. no CMD arguments reached us),
# default to the standalone Next.js server, honoring $PORT (default 3000).
if [ "${1:-}" = "" ]; then
  set -- node server.js
fi

echo "[entrypoint] Starting ZAI Support System on port ${PORT:-3000}..."
exec "$@"
