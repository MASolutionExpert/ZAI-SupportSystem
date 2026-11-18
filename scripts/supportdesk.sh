#!/usr/bin/env bash
# =============================================================================
# Support Desk — management CLI  ("supportdesk")
#
# Usage:  ./scripts/supportdesk.sh <command> [args]
#
# Commands:
#   install            First-time installation: create .env (generated secrets),
#                      pull the image, start services, wait for health.
#                      Idempotent — never overwrites an existing .env or data.
#                      Headless: SUPPORTDESK_NONINTERACTIVE=1 with
#                      SUPERADMIN_PASSWORD (and optional SUPERADMIN_USERNAME,
#                      APP_URL) from the environment.
#   update [version]   Backup first, then pull & deploy image tag <version>
#                      (e.g. 0.2.0). Without an argument, re-pulls the pinned
#                      tag. Records the previous image in .deploy-state.
#   rollback           Switch back to the image recorded by the last 'update'
#                      (health-gated; DB schema is NOT downgraded — restore a
#                      backup if migrations are incompatible).
#   backup             Consistent backup archive (DB + storage + .env) under
#                      ./backups — brief downtime while the app is stopped.
#   restore <file>     DESTRUCTIVE! Restore DB, storage and .env from a backup.
#   status             Compose status, health endpoint output, volume usage.
#   logs [n]           Show the last n log lines (default 200).
#   version            VERSION file vs running image vs health endpoint.
#   help               This help.
#
# The script always operates on the deployment folder that contains
# docker-compose.yml (resolved from this script's real path, even through a
# symlink). Requires: docker (with compose v2 plugin), curl; run as root or as
# a user in the "docker" group.
#
# Persian quick hints (راهنمای سریع):
#   نصب:        ./scripts/supportdesk.sh install
#   وضعیت:      ./scripts/supportdesk.sh status
#   پشتیبان‌گیری: ./scripts/supportdesk.sh backup
# =============================================================================
set -euo pipefail
export LC_ALL=C   # deterministic grep/regex classes for password validation

# --- Resolve the real script location (works through symlinks) ----------------
INVOCATION_DIR="$(pwd -P)"
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  case "$SOURCE" in /*) ;; *) SOURCE="$DIR/$SOURCE" ;; esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
DEPLOY_DIR="$(cd -P "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/.env"
ENV_EXAMPLE="$DEPLOY_DIR/.env.example"
VERSION_FILE="$DEPLOY_DIR/VERSION"
BACKUP_DIR="$DEPLOY_DIR/backups"
APP_CONTAINER="supportdesk-app"   # matches container_name in docker-compose.yml
STATE_FILE="$DEPLOY_DIR/.deploy-state"  # records the previous image for rollback
DEFAULT_GHCR_REPO="ghcr.io/miladalefbusiness/zai-supportsystem"  # CI publishes here

cd "$DEPLOY_DIR"

# --- Output helpers (colors only on a TTY; secrets are NEVER printed) ---------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[0;31m'
  C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'; C_BLUE=$'\033[0;34m'
else
  C_RESET=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi
info()  { printf '%s\n' "${C_BLUE}==>${C_RESET} ${1}"; }
ok()    { printf '%s\n' "${C_GREEN}✔${C_RESET} ${1}"; }
warn()  { printf '%s\n' "${C_YELLOW}!${C_RESET} ${1}" >&2; }
err()   { printf '%s\n' "${C_RED}✖${C_RESET} ${1}" >&2; }
banner() {
  printf '%s\n' "${C_BOLD}Support Desk — management CLI${C_RESET}"
}

# --- Preconditions --------------------------------------------------------------
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: '$1'. Please install it first."
    exit 1
  fi
}
require_docker() {
  require_cmd docker
  if ! docker info >/dev/null 2>&1; then
    err "Docker daemon is not reachable. Is Docker running, and does this user have access (docker group or sudo)?"
    exit 1
  fi
}
require_compose() {
  if ! docker compose version >/dev/null 2>&1; then
    err "Docker Compose v2 plugin not found (need 'docker compose', not the legacy 'docker-compose')."
    exit 1
  fi
}
require_curl()  { require_cmd curl; }
require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    err ".env not found in ${DEPLOY_DIR} — run './scripts/supportdesk.sh install' first."
    exit 1
  fi
}

# --- Read-only config helpers (never echo secret values) --------------------------
env_value() {  # env_value KEY -> prints the value of KEY from .env (or empty)
  sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" "$ENV_FILE" 2>/dev/null \
    | tail -n 1 | sed -e 's/[[:space:]]*$//'
}
get_host_port() {
  local p
  p="$(env_value APP_PORT | tr -dc '0-9')"
  if [ -z "$p" ]; then p="3000"; fi
  printf '%s' "$p"
}
get_app_version() {
  cat "$VERSION_FILE" 2>/dev/null || printf 'unknown'
}
get_image() {
  local img
  img="${SUPPORTDESK_IMAGE:-$(env_value SUPPORTDESK_IMAGE)}"
  if [ -z "$img" ]; then
    img="supportdesk:$(get_app_version)"
  fi
  printf '%s' "$img"
}
image_has_registry() {  # true when the image reference carries a registry/repo path
  case "$1" in */*) return 0 ;; *) return 1 ;; esac
}
image_base() {  # strip the ":tag" suffix (last colon — safe for registry:port)
  printf '%s' "$1" | sed 's/:[^:]*$//'
}
upsert_env_key() {  # upsert_env_key KEY VALUE (value must not contain '|')
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# --- Docker state helpers ----------------------------------------------------------
container_exists() {
  docker inspect "$APP_CONTAINER" >/dev/null 2>&1
}
container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null || true)" = "true" ]
}
volume_for() {  # volume_for /app/db -> real (project-prefixed) volume name
  local dest="$1" logical vol
  case "$dest" in
    /app/db)       logical="supportdesk_db" ;;
    /app/storage)  logical="supportdesk_storage" ;;
    *) return 0 ;;
  esac
  vol="$(docker inspect -f \
    "$(printf '{{range .Mounts}}{{if eq .Destination "%s"}}{{.Name}}{{end}}{{end}}' "$dest")" \
    "$APP_CONTAINER" 2>/dev/null || true)"
  if [ -z "$vol" ]; then
    vol="$(docker volume ls --format '{{.Name}}' 2>/dev/null \
      | grep -E "(^|_)${logical}\$" | tail -n 1 || true)"
  fi
  printf '%s' "$vol"
}

# --- Health helpers -------------------------------------------------------------------
health_url() {
  printf 'http://127.0.0.1:%s/api/health' "$(get_host_port)"
}
health_json() {  # prints the JSON body; nonzero exit when unhealthy
  curl -fsS --max-time 5 "$(health_url)" 2>/dev/null
}
wait_for_health() {
  local timeout="${1:-120}" elapsed=0
  info "Waiting for the health endpoint (${C_BOLD}$(health_url)${C_RESET}) — up to ${timeout}s ..."
  while [ "$elapsed" -lt "$timeout" ]; do
    if health_json >/dev/null; then
      ok "Health check passed."
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  err "Health check did not pass within ${timeout}s."
  return 1
}

# --- Interactive prompts (hidden input; values never echoed) ---------------------------
password_is_strong() {  # >= 12 chars incl. upper + lower + digit (app contract)
  local p="$1"
  [ "${#p}" -ge 12 ] || return 1
  printf '%s' "$p" | grep -q '[A-Z]' || return 1
  printf '%s' "$p" | grep -q '[a-z]' || return 1
  printf '%s' "$p" | grep -q '[0-9]' || return 1
  return 0
}
prompt_superadmin_username() {
  local u
  read -r -p "Super Admin username [admin]: " u || { err "Input aborted."; exit 1; }
  if [ -z "$u" ]; then u="admin"; fi
  SA_USERNAME="$u"
}
prompt_app_url() {
  local u
  read -r -p "Canonical public URL, e.g. https://support.example.com [empty if undecided]: " u \
    || { err "Input aborted."; exit 1; }
  SA_APP_URL="$u"
}
prompt_superadmin_password() {
  local p1 p2 tries=0
  while :; do
    read -r -s -p "Super Admin initial password (hidden; >= 12 chars incl. upper+lower+digit): " p1 \
      || { printf '\n'; err "Input aborted."; exit 1; }
    printf '\n'
    if ! password_is_strong "$p1"; then
      tries=$((tries + 1))
      warn "Password too weak — minimum 12 characters with upper case, lower case and a digit. (رمز عبور ضعیف است)"
      if [ "$tries" -ge 3 ]; then
        err "Aborting install after 3 weak password attempts."
        exit 1
      fi
      continue
    fi
    read -r -s -p "Confirm Super Admin password (hidden): " p2 \
      || { printf '\n'; err "Input aborted."; exit 1; }
    printf '\n'
    if [ "$p1" != "$p2" ]; then
      warn "Passwords do not match — try again."
      continue
    fi
    SA_PASSWORD="$p1"
    return 0
  done
}
confirm() {  # confirm "<question>" — the user must type YES
  local reply=""
  read -r -p "$1 Type YES to confirm: " reply || { printf '\n'; return 1; }
  [ "$reply" = "YES" ]
}
maybe_confirm() {  # confirm, unless SUPPORTDESK_NONINTERACTIVE=1 (automation/CI)
  if [ "${SUPPORTDESK_NONINTERACTIVE:-0}" = "1" ]; then
    info "Non-interactive mode — proceeding automatically."
    return 0
  fi
  confirm "$1"
}

# --- Port / domain pre-flight notes ------------------------------------------------------
check_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "[:.]${port}\$" >/dev/null 2>&1; then
      warn "Host port ${port} appears to be in use already. Choose another APP_PORT in .env (e.g. APP_PORT=8080) or stop the conflicting service."
    else
      ok "Host port ${port} is free."
    fi
  else
    warn "'ss' is not available — skipping the port availability check."
  fi
  info "If you will use a domain (e.g. support.example.com), point its DNS A record at this server now, then enable HTTPS via deploy/caddy (see DEPLOYMENT.md)."
}

print_next_steps() {
  local port url
  port="$(get_host_port)"
  url="$(env_value APP_URL)"
  ok "Installation finished successfully. (نصب با موفقیت انجام شد)"
  echo
  echo "  Next steps (گام‌های بعدی):"
  echo "   1. Open the app:      ${url:-http://<server-ip>:${port}}"
  echo "   2. Sign in as:        $(env_value SUPERADMIN_USERNAME)"
  echo "      First login forces a password change (enforced by the app)."
  echo "   3. Enable HTTPS:      docker compose -f docker-compose.yml -f deploy/caddy/docker-compose.caddy.yml up -d"
  echo "   4. First backup:      ./scripts/supportdesk.sh backup"
  echo "   5. Status / logs:     ./scripts/supportdesk.sh status | logs"
  echo
}

# =============================================================================
# Command: install
# =============================================================================
cmd_install() {
  banner
  require_docker
  require_compose
  require_curl
  if ! command -v openssl >/dev/null 2>&1; then
    err "Required command not found: openssl (needed to generate secrets)."
    exit 1
  fi
  info "Deployment folder: ${DEPLOY_DIR}"

  # --- 1. Environment configuration (never overwrite an existing .env) ---
  if [ -f "$ENV_FILE" ]; then
    warn ".env already exists — KEEPING it (install never overwrites existing configuration or data)."
    local key missing=0
    for key in DATABASE_URL AUTH_SECRET SUPERADMIN_USERNAME SUPERADMIN_PASSWORD; do
      if ! grep -qE "^${key}=" "$ENV_FILE"; then
        err "Missing required key in existing .env: ${key}"
        missing=1
      fi
    done
    if [ "$missing" -eq 1 ]; then
      err "Fix .env manually, or move it aside and re-run install to regenerate it."
      exit 1
    fi
    if [ -z "$(env_value SUPERADMIN_PASSWORD)" ]; then
      warn "SUPERADMIN_PASSWORD is empty in .env — the first bootstrap will not be able to create the Super Admin."
    fi
  else
    if [ ! -f "$ENV_EXAMPLE" ]; then
      err ".env.example not found in ${DEPLOY_DIR}."
      exit 1
    fi
    if [ "${SUPPORTDESK_NONINTERACTIVE:-0}" = "1" ] || [ ! -t 0 ]; then
      # Headless mode (automation / CI / curl | bash without a TTY):
      # credentials MUST come from the environment; nothing is prompted.
      if [ -z "${SUPERADMIN_PASSWORD:-}" ]; then
        err "Headless install requires SUPERADMIN_PASSWORD in the environment (>= 12 chars incl. upper+lower+digit)."
        exit 1
      fi
      if ! password_is_strong "${SUPERADMIN_PASSWORD:-}"; then
        err "SUPERADMIN_PASSWORD is too weak — minimum 12 characters with upper case, lower case and a digit."
        exit 1
      fi
      SA_USERNAME="${SUPERADMIN_USERNAME:-admin}"
      SA_PASSWORD="$SUPERADMIN_PASSWORD"
      SA_APP_URL="${APP_URL:-}"
      GEN_AUTH_SECRET="$(openssl rand -base64 48)"
      GEN_ENC_KEY="$(openssl rand -base64 32)"
      info "Headless mode — credentials read from the environment (SUPERADMIN_USERNAME=${SA_USERNAME})."
    else
      info "Creating .env from .env.example — AUTH_SECRET / APP_ENCRYPTION_KEY are generated with openssl."
      GEN_AUTH_SECRET="$(openssl rand -base64 48)"
      GEN_ENC_KEY="$(openssl rand -base64 32)"
      prompt_superadmin_username
      prompt_superadmin_password
      prompt_app_url
    fi
    {
      grep -vE '^(AUTH_SECRET|APP_ENCRYPTION_KEY|SUPERADMIN_USERNAME|SUPERADMIN_PASSWORD|APP_URL)=' "$ENV_EXAMPLE"
      printf 'AUTH_SECRET=%s\n' "$GEN_AUTH_SECRET"
      printf 'APP_ENCRYPTION_KEY=%s\n' "$GEN_ENC_KEY"
      printf 'SUPERADMIN_USERNAME=%s\n' "$SA_USERNAME"
      printf 'SUPERADMIN_PASSWORD=%s\n' "$SA_PASSWORD"
      printf 'APP_URL=%s\n' "$SA_APP_URL"
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok ".env created (permissions 600). NEVER commit this file to git."
  fi

  # --- 1b. Default registry image (published by the Release workflow) ---------
  if [ -z "$(env_value SUPPORTDESK_IMAGE)" ]; then
    local default_image
    default_image="${DEFAULT_GHCR_REPO}:$(get_app_version)"
    info "Pinning the default image: ${default_image}"
    upsert_env_key SUPPORTDESK_IMAGE "$default_image"
  fi

  # --- 2. Persistent directories (DB + files live in named Docker volumes) ---
  mkdir -p "$BACKUP_DIR" "$DEPLOY_DIR/db" "$DEPLOY_DIR/storage"
  info "Database and uploaded files persist in named Docker volumes (supportdesk_db, supportdesk_storage); ./backups holds backup archives."

  # --- 3. Image resolution & pull (respect SUPPORTDESK_IMAGE) ---
  local image
  image="$(get_image)"
  if image_has_registry "$image"; then
    info "Pulling image: ${image}"
    docker pull "$image"
  else
    if docker image inspect "$image" >/dev/null 2>&1; then
      info "Using locally available image: ${image}"
    else
      err "Image '${image}' is not available locally and has no registry prefix."
      echo "   - Preferred: set SUPPORTDESK_IMAGE=ghcr.io/<org>/<repo>:X.Y.Z in .env and re-run install."
      echo "   - Or build locally: uncomment the 'build:' block in docker-compose.yml, then run: docker compose build"
      exit 1
    fi
  fi

  # --- 4. Port & domain checks ---
  local port
  port="$(get_host_port)"
  check_port "$port"

  # --- 5. Start services ---
  info "Starting services (docker compose up -d) ..."
  docker compose up -d

  # --- 6. Wait for /api/health ---
  if ! wait_for_health 120; then
    err "The app did not become healthy. Recent logs:"
    docker compose logs --tail=50 app || true
    info "Inspect further with: ./scripts/supportdesk.sh logs 200"
    exit 1
  fi

  # --- 7. Report ---
  print_next_steps
}

# =============================================================================
# Command: backup  (brief downtime: app is stopped for a consistent SQLite copy)
# =============================================================================
cmd_backup() {
  banner
  require_docker
  require_compose
  require_env_file

  local stamp backup_path staging was_running=false db_vol stor_vol image
  stamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  backup_path="$BACKUP_DIR/supportdesk-backup-${stamp}.tar.gz"
  staging="$(mktemp -d "${BACKUP_DIR}/.staging-${stamp}.XXXXXX")"
  mkdir -p "${staging}/db"

  image="$(get_image)"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    err "Image '${image}' is not present locally — start the app once (install) before backing up."
    rm -rf "$staging"
    exit 1
  fi

  db_vol="$(volume_for /app/db)"
  stor_vol="$(volume_for /app/storage)"
  if [ -z "$db_vol" ]; then
    err "Could not resolve the database volume — has the app been started at least once (docker compose up -d)?"
    rm -rf "$staging"
    exit 1
  fi
  if [ -z "$stor_vol" ]; then
    err "Could not resolve the storage volume."
    rm -rf "$staging"
    exit 1
  fi

  if container_running; then
    was_running=true
    warn "Brief downtime: stopping the app container for a consistent SQLite copy..."
    docker compose stop app
  else
    info "App container is not running — copying files directly."
  fi

  # On any failure: restore service state and clean up.
  backup_failure() {
    if [ "${was_running:-false}" = "true" ] && ! container_running; then
      warn "Backup failed — restarting the app container..."
      docker compose start app >/dev/null 2>&1 || true
    fi
    if [ -n "${staging:-}" ] && [ -d "$staging" ]; then
      rm -rf "$staging"
    fi
    err "Backup failed."
  }
  trap backup_failure ERR

  info "Copying database files from volume '${db_vol}'..."
  # Safe plain copy: SQLite is stopped cleanly (no writer, no hot journal).
  docker run --rm -v "${db_vol}:/src:ro" -v "${staging}/db:/dst" "$image" \
    sh -c 'cp -a /src/. /dst/'
  info "Archiving storage volume '${stor_vol}'..."
  docker run --rm -v "${stor_vol}:/src:ro" -v "${staging}:/dst" "$image" \
    sh -c 'tar czf /dst/storage.tar.gz -C /src .'
  info "Adding .env copy (permissions 600)..."
  cp "$ENV_FILE" "${staging}/.env"
  chmod 600 "${staging}/.env"

  tar -C "$staging" -czf "$backup_path" .env db storage.tar.gz
  rm -rf "$staging"
  trap - ERR

  if [ "$was_running" = "true" ]; then
    info "Restarting the app container..."
    docker compose start app
    if ! wait_for_health 90; then
      warn "App restarted but is not healthy yet — check './scripts/supportdesk.sh logs'."
    fi
  fi

  printf '%s\n' "$backup_path" > "${BACKUP_DIR}/.last-backup-path"
  ok "Backup created: ${backup_path} ($(du -h "$backup_path" | awk '{print $1}'))"
}

# =============================================================================
# Command: restore <backup-file>  (DESTRUCTIVE — replaces current data)
# =============================================================================
cmd_restore() {
  local file="${1:-}"
  if [ -z "$file" ]; then
    err "Usage: ./scripts/supportdesk.sh restore <backup-file.tar.gz>"
    exit 1
  fi
  if [ ! -f "$file" ] && [ -f "${INVOCATION_DIR}/${file}" ]; then
    file="${INVOCATION_DIR}/${file}"
  fi
  if [ ! -f "$file" ]; then
    err "Backup file not found: ${file}"
    exit 1
  fi
  banner
  require_docker
  require_compose
  require_env_file

  echo
  warn "RESTORE IS DESTRUCTIVE: the current database, storage files and .env will be REPLACED."
  warn "(بازیابی، داده‌های فعلی را بازنویسی می‌کند)"
  if ! confirm "Restore from '${file}'?"; then
    err "Aborted by user."
    exit 1
  fi

  local stamp staging image db_vol stor_vol was_running=false
  stamp="$(date +%Y%m%d-%H%M%S)"
  staging="$(mktemp -d "${DEPLOY_DIR}/.restore-${stamp}.XXXXXX")"
  image="$(get_image)"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    err "Image '${image}' is not present locally — pull it first (docker pull ${image})."
    rm -rf "$staging"
    exit 1
  fi

  info "Extracting archive..."
  tar -xzf "$file" -C "$staging"
  if ! ls "${staging}"/db/*.db >/dev/null 2>&1; then
    err "Archive does not contain a database file (db/*.db) — is this a Support Desk backup?"
    rm -rf "$staging"
    exit 1
  fi
  if [ ! -f "${staging}/.env" ]; then
    warn "Archive contains no .env — the current .env will be kept."
  fi

  db_vol="$(volume_for /app/db)"
  stor_vol="$(volume_for /app/storage)"
  if [ -z "$db_vol" ] || [ -z "$stor_vol" ]; then
    err "Data volumes not found — run 'docker compose up -d' once before restoring."
    rm -rf "$staging"
    exit 1
  fi

  if container_running; then
    was_running=true
    info "Stopping the app container..."
    docker compose stop app
  fi

  restore_failure() {
    if [ "${was_running:-false}" = "true" ] && ! container_running; then
      warn "Restore failed — restarting the app container..."
      docker compose start app >/dev/null 2>&1 || true
    fi
    err "Restore failed — volumes may be partially restored. Re-run with the most recent good backup."
  }
  trap restore_failure ERR

  info "Restoring database volume '${db_vol}'..."
  docker run --rm -v "${db_vol}:/dst" -v "${staging}/db:/src:ro" "$image" \
    sh -c 'find /dst -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cp -a /src/. /dst/'
  if [ -f "${staging}/storage.tar.gz" ]; then
    info "Restoring storage volume '${stor_vol}'..."
    docker run --rm -v "${stor_vol}:/dst" -v "${staging}:/src:ro" "$image" \
      sh -c 'find /dst -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /src/storage.tar.gz -C /dst'
  else
    warn "No storage.tar.gz in the archive — storage volume left unchanged."
  fi
  if [ -f "${staging}/.env" ]; then
    info "Restoring .env (previous copy kept as .env.pre-restore-${stamp})..."
    if [ -f "$ENV_FILE" ]; then
      cp "$ENV_FILE" "${DEPLOY_DIR}/.env.pre-restore-${stamp}"
    fi
    cp "${staging}/.env" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi

  rm -rf "$staging"
  trap - ERR

  if [ "$was_running" = "true" ]; then
    info "Starting the app..."
    docker compose start app
    if wait_for_health 90; then
      ok "Restore complete — verify login, data and files before deleting the old backup."
    else
      warn "Restore finished but health is pending — verify with './scripts/supportdesk.sh status'."
    fi
  else
    ok "Restore complete. Start the app with: docker compose up -d"
  fi
}

# =============================================================================
# Command: update [version]
# =============================================================================
cmd_update() {
  local target="${1:-}"
  banner
  require_docker
  require_compose
  require_env_file
  require_curl

  local current_file current_image base new_image backup_hint
  current_file="$(get_app_version)"
  current_image="$(get_image)"
  info "Current VERSION file: ${current_file}"
  info "Pinned image:         ${current_image}"
  if container_exists; then
    info "Running image:        $(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || printf 'unknown')"
  fi

  # 1) Backup first (brief downtime inside cmd_backup).
  cmd_backup
  backup_hint="$(cat "${BACKUP_DIR}/.last-backup-path" 2>/dev/null || printf '<last backup>')"

  # 2) Resolve the requested image tag.
  if [ -n "$target" ]; then
    base="$(image_base "$current_image")"
    new_image="${base}:${target}"
    info "Switching image tag: ${current_image} -> ${new_image}"
    upsert_env_key SUPPORTDESK_IMAGE "$new_image"
  else
    new_image="$(get_image)"
    info "No version argument given — re-pulling the pinned tag: ${new_image}"
  fi

  # 3) Pull the requested image.
  if image_has_registry "$new_image"; then
    docker pull "$new_image"
  else
    if ! docker image inspect "$new_image" >/dev/null 2>&1; then
      err "Image '${new_image}' is not available locally and has no registry prefix."
      info "Set SUPPORTDESK_IMAGE=ghcr.io/<org>/<repo>:X.Y.Z in .env, or build locally (see DEPLOYMENT.md)."
      exit 1
    fi
  fi

  # Record the previous image so `rollback` can switch back to it.
  # (Written before any change; only when the tag actually changes.)
  if [ -n "$target" ] && [ "$new_image" != "$current_image" ]; then
    printf 'previous_image=%s\nprevious_set_at=%s\n' "$current_image" "$(date '+%Y-%m-%dT%H:%M:%S%z')" > "$STATE_FILE"
    info "Rollback point recorded: ${current_image}"
  fi

  # 4) Recreate the app container with the new image.
  info "Recreating the app container (docker compose up -d)..."
  docker compose up -d

  # 5) Verify health; on failure print rollback hints.
  if wait_for_health 120; then
    ok "Update successful — now running: ${new_image}"
    info "Pre-update backup: ${backup_hint} — keep it until you have verified the new version."
  else
    err "Update FAILED health verification."
    echo
    echo "  Rollback options (see BACKUP-RESTORE.md):"
    echo "   1. Restore data:   ./scripts/supportdesk.sh restore ${backup_hint}"
    echo "   2. Revert image:   set in .env:"
    echo "          SUPPORTDESK_IMAGE=${current_image}"
    echo "      then run:      docker compose up -d"
    echo
    exit 1
  fi
}

# =============================================================================
# Command: rollback  (health-gated switch back to the previous image)
# =============================================================================
cmd_rollback() {
  banner
  require_docker
  require_compose
  require_env_file
  require_curl

  local prev current
  if [ ! -f "$STATE_FILE" ]; then
    err "No rollback point recorded — 'update' writes one before every version change."
    echo "   Manual revert: set SUPPORTDESK_IMAGE=<previous tag> in .env, then: docker compose up -d"
    exit 1
  fi
  prev="$(sed -n 's/^previous_image=//p' "$STATE_FILE" | tail -n 1)"
  current="$(get_image)"
  if [ -z "$prev" ]; then
    err "${STATE_FILE} does not contain a previous_image entry."
    exit 1
  fi
  if [ "$prev" = "$current" ]; then
    warn "Current image already equals the rollback point (${current}) — nothing to do."
    return 0
  fi

  warn "ROLLBACK: ${current} -> ${prev}"
  warn "Note: rollback does NOT downgrade the database schema. If the failed release"
  warn "applied incompatible migrations, restore data instead:"
  warn "  ./scripts/supportdesk.sh restore <backup.tar.gz>"
  if ! maybe_confirm "Roll back to ${prev}?"; then
    err "Aborted by user."
    exit 1
  fi

  info "Pulling the rollback image (if from a registry)..."
  if image_has_registry "$prev"; then
    docker pull "$prev"
  else
    if ! docker image inspect "$prev" >/dev/null 2>&1; then
      err "Image '${prev}' is not available locally and has no registry prefix."
      exit 1
    fi
  fi

  info "Switching image tag..."
  upsert_env_key SUPPORTDESK_IMAGE "$prev"
  info "Recreating the app container (docker compose up -d)..."
  docker compose up -d

  if wait_for_health 120; then
    ok "Rollback complete — now running: ${prev}"
    # Rotate the rollback point so the operator can flip back if needed.
    printf 'previous_image=%s\nprevious_set_at=%s\n' "$current" "$(date '+%Y-%m-%dT%H:%M:%S%z')" > "$STATE_FILE"
  else
    err "Rollback FAILED the health gate — the previous image is unhealthy too."
    echo "   Inspect: ./scripts/supportdesk.sh logs 200"
    echo "   Last-resort: restore data from a backup and keep this image."
    exit 1
  fi
}

# =============================================================================
# Command: status
# =============================================================================
cmd_status() {
  banner
  require_docker
  require_compose

  info "Compose services:"
  docker compose ps || true
  echo

  local port health
  port="$(get_host_port)"
  info "Health endpoint (http://127.0.0.1:${port}/api/health):"
  health="$(health_json || true)"
  if [ -n "$health" ]; then
    printf '%s\n' "$health"
    ok "Application reports healthy."
  else
    err "Health endpoint not reachable (container running? APP_PORT correct?)."
  fi
  echo

  if container_exists; then
    local db_vol stor_vol image
    db_vol="$(volume_for /app/db)"
    stor_vol="$(volume_for /app/storage)"
    image="$(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
    info "Running image: ${image:-unknown}"
    if [ -n "$db_vol" ] && [ -n "$image" ]; then
      info "Database volume usage (${db_vol}):"
      docker run --rm -v "${db_vol}:/data:ro" "$image" du -sh /data 2>/dev/null || true
    fi
    if [ -n "$stor_vol" ] && [ -n "$image" ]; then
      info "Storage volume usage (${stor_vol}):"
      docker run --rm -v "${stor_vol}:/data:ro" "$image" du -sh /data 2>/dev/null || true
    fi
  else
    warn "Container ${APP_CONTAINER} does not exist yet — run './scripts/supportdesk.sh install'."
  fi

  local count
  count="$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -c '^supportdesk-backup-.*\.tar\.gz$' || true)"
  info "Backups: ${count} archive(s) in ${BACKUP_DIR}"
}

# =============================================================================
# Command: logs [n]
# =============================================================================
cmd_logs() {
  require_docker
  require_compose
  local n="${1:-200}"
  case "$n" in
    ''|*[!0-9]*) n="200" ;;
  esac
  docker compose logs --tail="$n" app
}

# =============================================================================
# Command: version
# =============================================================================
cmd_version() {
  printf 'VERSION file:    %s\n' "$(get_app_version)"
  if container_exists; then
    printf 'Running image:   %s\n' "$(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || printf 'unknown')"
  else
    printf 'Running image:   (container not created yet)\n'
  fi
  local health v
  health="$(health_json || true)"
  if [ -n "$health" ]; then
    v="$(printf '%s' "$health" | grep -o '"version":"[^"]*"' | head -n 1 | cut -d '"' -f 4)"
    printf 'Health endpoint: version=%s (healthy)\n' "${v:-unknown}"
  else
    printf 'Health endpoint: unreachable\n'
  fi
}

# =============================================================================
# Command: help
# =============================================================================
cmd_help() {
  cat <<'EOF'
Support Desk — management CLI (supportdesk)

Usage: ./scripts/supportdesk.sh <command> [args]

Commands:
  install           First-time installation: create .env (generated secrets),
                    pull the image, start services, wait for health.
                    Idempotent — never overwrites an existing .env or data.
                    Headless: SUPPORTDESK_NONINTERACTIVE=1 + SUPERADMIN_PASSWORD env.
  update [version]  Backup first, then pull & deploy image tag <version>
                    (e.g. 0.2.0). Without an argument, re-pulls the pinned tag.
  rollback          Health-gated switch back to the image recorded by the
                    last 'update' (.deploy-state). DB schema is not downgraded.
  backup            Consistent backup archive (DB + storage + .env) under
                    ./backups. Brief downtime while the app is stopped.
  restore <file>    DESTRUCTIVE! Restore DB, storage and .env from a backup.
  status            Compose status, health endpoint output, volume disk usage.
  logs [n]          Last n log lines (default 200).
  version           VERSION file vs running image vs health endpoint version.
  help              This help.

Environment:
  SUPPORTDESK_NONINTERACTIVE=1   Never prompt (automation); restore/rollback
                                 proceed automatically after their warnings.

Typical first run (as root or a user in the "docker" group):
  ./scripts/supportdesk.sh install

Docs: DEPLOYMENT.md (deployment guide), BACKUP-RESTORE.md (backup policy).
EOF
}

# =============================================================================
# Entry point / dispatch
# =============================================================================
SA_USERNAME="admin"
SA_PASSWORD=""
SA_APP_URL=""
GEN_AUTH_SECRET=""
GEN_ENC_KEY=""

if [ ! -f "$COMPOSE_FILE" ]; then
  err "docker-compose.yml not found in ${DEPLOY_DIR} — run this CLI from a Support Desk deployment folder."
  exit 1
fi

command="${1:-help}"
case "$command" in
  install)  shift || true; cmd_install "$@" ;;
  update)   shift || true; cmd_update "$@" ;;
  rollback) shift || true; cmd_rollback "$@" ;;
  backup)   shift || true; cmd_backup "$@" ;;
  restore) shift || true; cmd_restore "$@" ;;
  status)  cmd_status ;;
  logs)    shift || true; cmd_logs "$@" ;;
  version) cmd_version ;;
  help|--help|-h) cmd_help ;;
  *)
    err "Unknown command: ${command}"
    echo
    cmd_help
    exit 1
    ;;
esac
