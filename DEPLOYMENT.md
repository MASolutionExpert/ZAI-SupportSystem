# Support Desk — Deployment Guide

Self-hosted deployment of **Support Desk** (Persian RTL organizational AI support desk & file hub), **v0.7.0 final** — all seven phases shipped: authentication/RBAC/audit foundation, departments & operators, knowledge base + grounded AI assistant, customer portal & ticketing with fair distribution, shared file hub with quotas and antivirus integration, super-admin reporting & audit viewer, and the production-hardening verification of this phase.

This guide covers a **single-node, Docker-based production installation** with versioned images, safe migrations, backups, upgrades and rollback.

---

## 1. Architecture (what gets deployed)

| Component | Implementation |
|---|---|
| Application | Next.js 16 (App Router) production server, **listens on port 3000**, runs as non-root user inside the container |
| Database | **SQLite v1** (Prisma ORM) on the named volume `supportdesk_db` → `/app/db/supportdesk.db`. *No database service is deployed* — the Prisma schema is provider-portable to PostgreSQL later (see `DATABASE.md`) |
| File storage | Named volume `supportdesk_storage` → `/app/storage` (`STORAGE_DIR`) — KB documents, ticket attachments and shared file-hub blobs (randomized keys, outside the web root) |
| Migrations | Versioned (`20261115142728_init_phase1_foundation` → `20261116130000_phase5_file_hub`), applied with `prisma migrate deploy` (pending-only, never resets) on startup (`MIGRATE_ON_STARTUP=true`) |
| Health | `GET /api/health` → `200 {"status":"ok","checks":{"database":true},...}` or `503` when the database is unreachable; wired into the Docker `HEALTHCHECK` and compose healthcheck |
| Reverse proxy | Optional Caddy 2 overlay (automatic HTTPS) or your own nginx |
| Management | `./scripts/supportdesk.sh` (`install`, `update`, `backup`, `restore`, `status`, `logs`, `version`, `help`) |
| CI/CD | GitHub Actions: `ci.yml` (lint/typecheck/build) and `release.yml` (publishes versioned images to ghcr.io — `X.Y.Z`, `X.Y`, `X`; **never** `:latest`) |

---

## 2. Prerequisites

- **OS:** Ubuntu 22.04+ or Debian 12 (any host that runs Docker works).
- **Docker Engine** with the **Compose v2 plugin** (`docker compose version` must work):
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- **DNS:** an A record pointing your domain (e.g. `support.example.com`) at the server's public IP — needed only if you want HTTPS via the Caddy overlay.
- **Ports:** `3000` (or your `APP_PORT`) for the app; `80` + `443` for Caddy/HTTPS.
- ~2 GB RAM and ~10 GB disk are sufficient for Phase 1.

Run the management CLI as `root` or as a user in the `docker` group.

---

## 3. First installation (one command)

### Step 0 — One-click bootstrap (fresh server)

On a brand-new server the whole flow — Docker check/install, code, installer — is one command:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/ZAI-SupportSystem/main/install.sh)
```

Headless (credentials via environment, no prompts):

```bash
SUPERADMIN_USERNAME=admin \
SUPERADMIN_PASSWORD='ChangeMe-Str0ng-Pass' \
APP_URL=https://support.example.com \
bash install-zai.sh --non-interactive
```

### Step 1 — Get the code

Either clone the repository:

```bash
git clone https://github.com/miladalefbusiness/ZAI-SupportSystem.git /opt/zai-supportsystem
cd /opt/zai-supportsystem
```

…or download and unpack a release archive, then `cd` into the folder that contains `docker-compose.yml`.

### Step 2 — Run the installer

```bash
./scripts/supportdesk.sh install
```

The installer is **idempotent** — re-running it never overwrites an existing `.env` or any data. It performs, in order:

1. Verifies Docker, Docker Compose v2, curl and openssl are available.
2. Creates `.env` from `.env.example` if missing (mode `600`), **generating `AUTH_SECRET` (openssl rand -base64 48) and `APP_ENCRYPTION_KEY` (openssl rand -base64 32)** automatically.
3. Prompts (hidden input) for the **initial Super Admin password** and refuses weak ones (< 12 chars or missing upper/lower/digit). The password is written only to `.env` and never committed or echoed.
4. Creates local working directories (`./backups`, placeholders `./db`, `./storage`); real data lives in the named Docker volumes.
5. Pulls the pinned image (`SUPPORTDESK_IMAGE` from `.env`; when unset the installer pins `ghcr.io/miladalefbusiness/zai-supportsystem:<VERSION>` — the image published by the Release workflow).
6. Checks host-port availability and prints DNS/domain notes.
7. Starts services with `docker compose up -d`.
8. The container entrypoint runs `prisma migrate deploy` (applies pending migrations only; creates the SQLite file if missing) and the app **bootstraps roles/permissions + the Super Admin only if missing** (`BOOTSTRAP_ON_STARTUP=true` — never overwrites existing data).
9. Waits up to 120 s for `/api/health` to return 200 and prints next steps.

### Step 3 — First login

1. Open `http://<server-ip>:3000` (or your `APP_URL`).
2. Sign in with `SUPERADMIN_USERNAME` (default `admin`) and the password chosen during install.
3. The app **forces a password change on first login**. Choose a strong new password; the initial one from `.env` is then obsolete.

### Step 4 — HTTPS (recommended)

```bash
# Edit deploy/caddy/Caddyfile: replace support.example.com with your domain
docker compose -f docker-compose.yml -f deploy/caddy/docker-compose.caddy.yml up -d
```

Caddy obtains/renews certificates automatically. Keep `FORCE_SECURE_COOKIES` empty — the app auto-detects HTTPS via `x-forwarded-proto`.

---

## 4. Environment variables (exact contract)

Written into `.env` (from `.env.example`). **Never commit the real `.env`.**

| Variable | Required | Example / default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | `file:/app/db/supportdesk.db` | SQLite file location (inside container, on the `supportdesk_db` volume) |
| `AUTH_SECRET` | yes | *generated* — `openssl rand -base64 48` | Session integrity secret, min 32 chars; `supportdesk install` generates it |
| `APP_ENCRYPTION_KEY` | optional (reserved) | *generated* — `openssl rand -base64 32` | 32-byte base64 key reserved for app-level PII encryption in later phases |
| `APP_URL` | optional | `https://support.example.com` | Canonical public URL |
| `SUPERADMIN_USERNAME` | yes | `admin` | Initial super-admin username (created only if missing) |
| `SUPERADMIN_PASSWORD` | yes (first bootstrap) | *none committed* | ≥ 12 chars incl. upper+lower+digit; app forces a change at first login |
| `BOOTSTRAP_ON_STARTUP` | optional | `true` | Idempotent bootstrap of roles/permissions + super admin **only if missing** |
| `SESSION_TTL_HOURS` | optional | `168` | Server-side session lifetime (hours) |
| `LOGIN_MAX_ATTEMPTS` | optional | `5` | Failed logins before lockout |
| `LOGIN_LOCK_MINUTES` | optional | `15` | Lockout duration (minutes) |
| `STORAGE_DIR` | optional | `/app/storage` | File storage root (on the `supportdesk_storage` volume) |
| `FORCE_SECURE_COOKIES` | optional | *(empty)* | Empty = auto-detect HTTPS via `x-forwarded-proto`; `true` = always `Secure` |
| `MIGRATE_ON_STARTUP` | optional | `true` | Entrypoint runs `prisma migrate deploy` on start; `false` = manual migrations |
| `APP_VERSION` | optional | *(empty)* | Override; normally read from the `VERSION` file |

Compose/CLI-only extras (not read by the app): `SUPPORTDESK_IMAGE` (pinned image reference, e.g. `ghcr.io/<org>/<repo>:0.1.0`) and `APP_PORT` (host port; container always listens on 3000).

---

## 5. Updating to a new version

```bash
./scripts/supportdesk.sh update 0.2.0
```

What it does: shows the current version → **creates a backup first** (`./backups/…tar.gz`, brief downtime) → **records the previous image in `.deploy-state`** (the rollback point) → rewrites `SUPPORTDESK_IMAGE` in `.env` to the new tag → pulls the image → `docker compose up -d` → waits for `/api/health` → reports success plus the pre-update backup path.

Without an argument it re-pulls the currently pinned tag (useful after mirror changes). Tags `X.Y.Z` (exact), `X.Y` and `X` (compatibility lines) are published by CI — **`latest` is intentionally never published**, so upgrades are always explicit and version-pinned.

---

## 6. Rollback

### Automatic rollback

```bash
./scripts/supportdesk.sh rollback
```

Switches back to the image recorded by the last `update` (`.deploy-state`), pulls it, recreates the container and health-gates the result. If the previous image is also unhealthy, the CLI says so and stops. The rollback point rotates after a successful rollback so you can flip back again.

> **Caveat:** rollback does NOT downgrade the database schema. If a failed release applied incompatible migrations, restore data from the pre-update backup (below) instead.

### Full rollback (image + data)

If an update misbehaves and data must also be reverted:

```bash
# 1. Revert the image
./scripts/supportdesk.sh rollback

# 2. Restore data (database + storage + .env) from the pre-update backup
./scripts/supportdesk.sh restore backups/supportdesk-backup-YYYYMMDD-HHMMSS.tar.gz
```

### Deploying from GitHub Actions

The **Production Deploy** workflow (`deploy.yml`, manual trigger) wraps exactly this logic over SSH: backup → pull → health gate → **automatic rollback** when the gate fails. One-time setup (secrets `GH_DEPLOY_HOST`, `GH_DEPLOY_USER`, `GH_DEPLOY_SSH_KEY`; variables `GH_DEPLOY_PORT`, `GH_DEPLOY_PATH`) is documented in the README, section "Deploying via GitHub Actions".

**Honest limitation:** database rollback after **incompatible** migrations is *not* automatic — Prisma migrations do not auto-downgrade. The supported recovery strategy is exactly the backup-and-restore flow above (restore the backup taken *before* the update, and run the previous image). See `BACKUP-RESTORE.md`.

---

## 7. Data, volumes and storage

| Volume | Mount point | Contents |
|---|---|---|
| `supportdesk_db` | `/app/db` | SQLite database (`supportdesk.db`) |
| `supportdesk_storage` | `/app/storage` | Uploaded/persistent files |

- Volumes survive rebuilds, upgrades and restarts; directories inside the image are pre-created as **uid 1000 (`node`)** so volumes inherit safe ownership on first use.
- Inspect actual (project-prefixed) names with `docker volume ls | grep supportdesk`.
- Do **not** switch to host bind mounts unless you replicate the ownership (`chown -R 1000:1000`).
- `supportdesk status` reports current disk usage of both volumes.

---

## 8. Health monitoring

- Endpoint: `GET /api/health` → `200 {"status":"ok","checks":{"database":true},"version":"0.1.0","uptimeSeconds":123,"timestamp":"ISO"}`; `503` when the database is unreachable.
- Docker/compose healthcheck runs every 30 s (`docker compose ps` shows `(healthy)` / `(unhealthy)`).
- Quick check: `curl -fsS http://127.0.0.1:3000/api/health` or `./scripts/supportdesk.sh status`.
- For external monitoring, poll `/api/health` and alert on non-200 responses or `status != "ok"`.

---

## 9. Reverse proxy alternatives

**Caddy (recommended, automatic HTTPS):** the overlay in `deploy/caddy/` — see §3 Step 4. It sets `request_body max_size 100MB`, gzip, and minimal security headers (HSTS).

**nginx (manual HTTPS):** terminate TLS yourself and proxy to the app:

```nginx
server {
    listen 443 ssl http2;
    server_name support.example.com;
    client_max_body_size 100M;          # keep in sync with the file-hub limits

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;   # required for Secure-cookie auto-detection
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Entrypoint exits with “DATABASE_URL is not set” | `.env` missing or not next to `docker-compose.yml` | Create `.env` (`./scripts/supportdesk.sh install`); compose loads it via `env_file` |
| `/api/health` returns `503` with `"database":false` | SQLite can't be opened/created | Check `docker compose logs app`; verify the `supportdesk_db` volume is mounted, disk not full, and `DATABASE_URL=file:/app/db/supportdesk.db` |
| `EACCES` / permission errors on `/app/db` or `/app/storage` | Volume owned by another uid (e.g. created via root bind mount) | Use named volumes; repair with `docker run --rm -u root -v supportdesk_db:/data <image> chown -R node:node /data` (same for storage) |
| “address already in use” / port 3000 busy | Another service on the host port | Set `APP_PORT=8080` (example) in `.env`, then `docker compose up -d` |
| `pull access denied` for `ghcr.io/...` | Package is private and you are not authenticated | `docker login ghcr.io` (token with `read:packages`), make the package public, or point `SUPPORTDESK_IMAGE` at your mirror |
| `manifest unknown` / tag not found | Wrong or unpublished version tag | List available tags in the registry; pin an exact published `X.Y.Z` |
| Caddy gets no certificate | DNS not pointing at the server, or ports 80/443 blocked | Fix the A record / firewall; check `docker compose logs caddy` |
| Super admin not created on first start | `BOOTSTRAP_ON_STARTUP=false`, or `SUPERADMIN_PASSWORD` empty/weak | Set `BOOTSTRAP_ON_STARTUP=true` and a ≥12-char password with upper+lower+digit; restart (`docker compose up -d`) |
| Health check passes locally but LB marks node down | Monitor uses wrong host/port | Poll the published `APP_PORT`, not 3000, when it differs |

---

## 11. Command reference

| Command | Purpose |
|---|---|
| `./scripts/supportdesk.sh install` | First install / re-run safe idempotent install |
| `./scripts/supportdesk.sh update [X.Y.Z]` | Backup + pull + deploy a version |
| `./scripts/supportdesk.sh backup` | Consistent backup archive (brief downtime) |
| `./scripts/supportdesk.sh restore <file>` | Restore DB/storage/.env (destructive, asks YES) |
| `./scripts/supportdesk.sh status` | Services, health JSON, volume usage, backups |
| `./scripts/supportdesk.sh logs [n]` | Last n app log lines (default 200) |
| `./scripts/supportdesk.sh version` | VERSION file vs running image vs health version |
| `docker compose logs -f app` | Follow logs |
| `docker compose pull && docker compose up -d` | Manual upgrade of the pinned tag |

---

## 12. Honest limitations (final)

- **Single-node by design:** SQLite is single-writer; run exactly one app instance. Horizontal scale-out switches to PostgreSQL per `DATABASE.md` §5 (runbook verified as documented; execution requires a PostgreSQL host and the §5.2 export/import step).
- **Rate limiting is per-process** (in-memory): conversations, OTP, portal creation, login throttle and AI daily limits reset on restart and are not shared across replicas — consistent with the single-node design.
- **Rollback after incompatible migrations is manual** (backup-and-restore), not automatic — Prisma migrations never down-migrate; `supportdesk update` always backs up first for exactly this reason.
- **Antivirus is an integration point:** production must provision a clamd daemon; without it the file hub honestly reports «بدون اسکن» instead of pretending.
- **OTP delivery** requires an SMS gateway (the `portal.otp` seam returns an honest 503 until configured); dev-inline OTP cannot activate in production builds.
- **AI grounding is keyword-baseline** retrieval; the embedding seam (`embeddingModel` setting) is reserved for future semantic search.
- **Security contact:** SECURITY.md §7 is a launch-blocking field — fill it before public exposure.
- The management CLI prints English output with short Persian hints.
