#!/usr/bin/env bash
# =============================================================================
# ZAI Support System — one-click installer
# =============================================================================
# Bootstraps a complete production installation on a fresh server:
#   1. verifies prerequisites (bash/curl/git/docker),
#   2. optionally installs Docker via the official get.docker.com script,
#   3. clones this repository into a deployment folder (or reuses one),
#   4. delegates to scripts/supportdesk.sh install — which interactively asks
#      for the Super Admin username/password and the public URL, generates
#      cryptographic secrets (APP secrets + the PostgreSQL password), pulls
#      the pinned image, starts the three-container stack (app + PostgreSQL
#      + Redis) and waits for the health endpoint. Data lives in named
#      Docker volumes: redeploys, updates and CLI operations never touch it.
#
# One-liner (interactive, recommended):
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/ZAI-SupportSystem/main/install.sh)
#
# Headless / automated (credentials via environment):
#
#   curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/ZAI-SupportSystem/main/install.sh -o install-zai.sh
#   SUPERADMIN_PASSWORD='ChangeMe-Str0ng-Pass' bash install-zai.sh --non-interactive
#
# Flags:
#   --dir DIR          Deployment folder (default: ./zai-supportsystem)
#   --repo URL         Source repository (default: the official GitHub repo,
#                      overridable with ZAI_REPO_URL env)
#   --docker-install   Install Docker automatically via get.docker.com when
#                      missing (without this flag you are asked interactively)
#   --non-interactive  Never prompt: requires SUPERADMIN_PASSWORD env
#                      (>= 12 chars incl. upper+lower+digit); other settings
#                      come from SUPERADMIN_USERNAME / APP_URL env
#   --help             This help
# Remaining arguments are forwarded to: scripts/supportdesk.sh install
# =============================================================================
set -euo pipefail
export LC_ALL=C

DEFAULT_REPO_URL="https://github.com/miladalefbusiness/ZAI-SupportSystem.git"
REPO_URL="${ZAI_REPO_URL:-$DEFAULT_REPO_URL}"
TARGET_DIR="zai-supportsystem"
DOCKER_INSTALL_OPT=false
FORWARDED=()

# --- Output helpers -----------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[0;31m'
  C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'; C_BLUE=$'\033[0;34m'
else
  C_RESET=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi
info() { printf '%s\n' "${C_BLUE}==>${C_RESET} ${1}"; }
ok()   { printf '%s\n' "${C_GREEN}✔${C_RESET} ${1}"; }
warn() { printf '%s\n' "${C_YELLOW}!${C_RESET} ${1}" >&2; }
err()  { printf '%s\n' "${C_RED}✖${C_RESET} ${1}" >&2; }

show_help() { sed -n '3,45p' "$0" | sed 's/^# \{0,1\}//'; }

# --- Argument parsing ----------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)       show_help; exit 0 ;;
    --dir)           TARGET_DIR="${2:?--dir requires a value}"; shift 2 ;;
    --repo)          REPO_URL="${2:?--repo requires a value}"; shift 2 ;;
    --docker-install) DOCKER_INSTALL_OPT=true; shift ;;
    --non-interactive) export SUPPORTDESK_NONINTERACTIVE=1; shift ;;
    --)              shift; while [ $# -gt 0 ]; do FORWARDED+=("$1"); shift; done ;;
    *)               FORWARDED+=("$1"); shift ;;
  esac
done

# --- Keep stdin interactive under "curl | bash" --------------------------------
# A pipe from curl makes stdin a pipe, so interactive password prompts would
# die. Re-exec with /dev/tty when it is available (bash <(curl ...) does not
# need this — stdin is already the terminal there).
if [ ! -t 0 ] && [ "${SUPPORTDESK_NONINTERACTIVE:-0}" != "1" ] && [ -e /dev/tty ]; then
  info "Re-attaching the installer to your terminal..."
  exec bash "$0" "$@" < /dev/tty
fi

# --- Prerequisites ---------------------------------------------------------------
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: '$1'."
    exit 1
  fi
}

info "ZAI Support System — one-click installer"
require_cmd curl
require_cmd git

# Docker (install on demand)
if ! command -v docker >/dev/null 2>&1; then
  if [ "$DOCKER_INSTALL_OPT" = "true" ]; then
    install_docker="y"
  elif [ -t 0 ]; then
    printf '%s' "Docker is required but not installed. Install it now via https://get.docker.com? [y/N]: "
    read -r install_docker || install_docker="n"
  else
    install_docker="n"
  fi
  case "$install_docker" in
    [yY]*)
      info "Installing Docker (official convenience script, get.docker.com)..."
      curl -fsSL https://get.docker.com | sh
      if ! command -v docker >/dev/null 2>&1; then
        err "Docker installation did not complete — install Docker manually and re-run."
        exit 1
      fi
      ok "Docker installed."
      ;;
    *)
      err "Docker is required. Install it first (https://docs.docker.com/engine/install/), then re-run this installer."
      exit 1
      ;;
  esac
else
  ok "Docker found: $(docker --version 2>/dev/null | head -n1)"
fi

# Docker daemon reachable? (root or docker group)
if ! docker info >/dev/null 2>&1; then
  err "Docker daemon is not reachable for this user."
  echo "   Run this installer as root (sudo bash install.sh) or add your user to the 'docker' group:"
  echo "     sudo usermod -aG docker \"\$USER\" && newgrp docker"
  exit 1
fi

# --- Acquire the code ------------------------------------------------------------
if [ -f "$TARGET_DIR/docker-compose.yml" ] && [ -f "$TARGET_DIR/scripts/supportdesk.sh" ]; then
  ok "Existing deployment folder found: ${TARGET_DIR} — reusing it (nothing is overwritten)."
else
  info "Fetching the application (${REPO_URL}) -> ${TARGET_DIR}"
  rm -rf "${TARGET_DIR:?}/.tmp-clone" 2>/dev/null || true
  if [ -d "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
    err "Folder '${TARGET_DIR}' exists but is not a deployment folder. Use --dir to pick another location."
    exit 1
  fi
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

# --- Delegate to the management CLI ----------------------------------------------
# scripts/supportdesk.sh install:
#   * creates .env with openssl-generated AUTH_SECRET / APP_ENCRYPTION_KEY,
#   * asks for Super Admin username + password (hidden input) and the public
#     URL — or takes them from the environment in --non-interactive mode,
#   * pulls the version-pinned image, starts the stack, waits for health.
info "Starting the installation wizard..."
exec ./scripts/supportdesk.sh install "${FORWARDED[@]+"${FORWARDED[@]}"}"
