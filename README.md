<div align="center">

# ZAI Support System
### «سامانه پشتیبانی هوشمند سازمان» — Organizational AI Support Desk & File Hub

[![CI](https://github.com/miladalefbusiness/ZAI-SupportSystem/actions/workflows/ci.yml/badge.svg)](https://github.com/miladalefbusiness/ZAI-SupportSystem/actions/workflows/ci.yml)
[![Release](https://github.com/miladalefbusiness/ZAI-SupportSystem/actions/workflows/release.yml/badge.svg)](https://github.com/miladalefbusiness/ZAI-SupportSystem/actions/workflows/release.yml)
[![CodeQL](https://github.com/miladalefbusiness/ZAI-SupportSystem/actions/workflows/codeql.yml/badge.svg)](https://github.com/miladalefbusiness/ZAI-SupportSystem/actions/workflows/codeql.yml)
[![Release version](https://img.shields.io/github/v/tag/miladalefbusiness/ZAI-SupportSystem?label=version&sort=semver)](https://github.com/miladalefbusiness/ZAI-SupportSystem/releases)
[![Docker image](https://img.shields.io/badge/image-ghcr.io-blue)](https://github.com/miladalefbusiness/ZAI-SupportSystem/pkgs/container/zai-supportsystem)

**Self-hosted · Persian-first (RTL) · Dockerized · CI/CD with automatic rollback**

</div>

---

A production-grade organizational support platform: a **public customer support portal**, an **operator helpdesk** with a concurrency-safe ticket engine, a **shared file hub** with fail-closed upload security, a **super-admin control panel**, and a **grounded AI assistant (RAG)** that answers strictly from an organization-managed knowledge base — with abstention and human escalation when the knowledge base is insufficient.

Built as a modular monolith on **Next.js 16 (App Router) + TypeScript + Prisma/SQLite + Tailwind 4 + shadcn/ui**, deployed as a **single Docker container** (or any Node 22 host), fronted by an optional **Caddy** reverse proxy for automatic HTTPS.

| Workspace | Highlights |
|---|---|
| Public portal (`/`) | Department cards, live AI chat (grounded, abstains, escalates), customer portal `/portal` with national-ID identity (AES-256-GCM at rest + keyed-HMAC index), OTP-verified history, ticket threads & attachments |
| Operator helpdesk (`/support`) | Ticket queues & filters, status machine, internal notes, assignment / transfer, fair-distribution engine (deterministic under concurrency), notifications |
| File hub (`/files`) | Department folders, content-verified MIME + allowlists, randomized storage keys, quotas, honest ClamAV gate (fail-closed), audited downloads |
| Admin panel (`/admin`) | Departments, users, roles + ALLOW/DENY overrides, KB & Q&A editor, RAG engine panel, reports + CSV, read-only audit viewer, storage & org settings, live health |
| RAG engine | Ingestion → chunking → hybrid lexical/vector retrieval (RRF) → Corrective-RAG loop → grounded generation with citation verification → evaluation suite (Recall@K / MRR / nDCG) |

---

## Table of contents

1. [One-click installation](#one-click-installation)
2. [What the installer asks](#what-the-installer-asks)
3. [First login](#first-login)
4. [Configuration reference](#configuration-reference)
5. [HTTPS / domain setup (Caddy)](#https--domain-setup-caddy)
6. [CI/CD pipelines](#cicd-pipelines)
7. [Deploying via GitHub Actions](#deploying-via-github-actions)
8. [Rollback](#rollback)
9. [Backup & restore](#backup--restore)
10. [Upgrading](#upgrading)
11. [Security posture](#security-posture)
12. [Development](#development)
13. [Project structure](#project-structure)
14. [Troubleshooting](#troubleshooting)
15. [Documentation set](#documentation-set)

---

## One-click installation

On a fresh server (Ubuntu/Debian recommended) with root or a `docker`-group user:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/ZAI-SupportSystem/main/install.sh)
```

That single command:

1. verifies prerequisites and **offers to install Docker** via the official `get.docker.com` script (confirmed interactively),
2. clones this repository into `./zai-supportsystem` (existing deployment folders are reused, never overwritten),
3. runs the management-CLI installation wizard: generates cryptographic secrets, asks for your settings, pulls the version-pinned image, starts the stack and **waits for the health endpoint** before declaring success.

Prefer explicit steps?

```bash
git clone --depth 1 https://github.com/miladalefbusiness/ZAI-SupportSystem.git
cd ZAI-SupportSystem
./scripts/supportdesk.sh install
```

Headless / automation-friendly install (no prompts — credentials from the environment):

```bash
curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/ZAI-SupportSystem/main/install.sh -o install-zai.sh
SUPERADMIN_USERNAME=admin \
SUPERADMIN_PASSWORD='ChangeMe-Str0ng-Pass' \
APP_URL=https://support.example.com \
bash install-zai.sh --non-interactive
```

> راهنمای فارسی — نصب سریع:
> `bash <(curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/ZAI-SupportSystem/main/install.sh)`
> سپس نام کاربری و رمز عبور مدیر ارشد و آدرس دامنه را وارد کنید.

## What the installer asks

| Prompt | Default | Notes |
|---|---|---|
| Super Admin username | `admin` | The initial administrator account |
| Super Admin password | — | Hidden input, confirmed twice; must be ≥ 12 chars with upper + lower + digit; **forced change on first login** |
| Canonical public URL | empty | e.g. `https://support.example.com` (can be set later) |

Generated automatically (never typed, never printed):

- `AUTH_SECRET` (session integrity) and `APP_ENCRYPTION_KEY` (customer national-ID encryption) — OpenSSL CSPRNG, `.env` written with `600` permissions;
- `SUPPORTDESK_IMAGE` pinned to `ghcr.io/miladalefbusiness/zai-supportsystem:<version>` — **explicit versions, never `:latest`**.

Afterwards: `./scripts/supportdesk.sh status | logs | version` — وضعیت، لاگ‌ها و نسخهٔ سامانه.

## First login

1. Open `http://<server-ip>:3000` (or your domain after the HTTPS step).
2. Sign in with the Super Admin credentials you chose.
3. The app **forces a password change** on first login.
4. Run your first backup: `./scripts/supportdesk.sh backup`.

## Configuration reference

All variables live in `.env` (created by the installer, documented inline in [.env.example](.env.example)):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file location (named volume `/app/db` in Docker) |
| `AUTH_SECRET` | Session-token integrity secret (generated) |
| `APP_ENCRYPTION_KEY` | AES-256-GCM key for national-ID encryption + HMAC index (generated) |
| `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` | First-bootstrap Super Admin (created only if missing) |
| `BOOTSTRAP_ON_STARTUP` | Idempotent bootstrap of roles/permissions/Super Admin (default `true`) |
| `APP_URL` | Canonical public URL |
| `APP_TRUSTED_ORIGINS` | Extra hosts accepted by the CSRF origin check (suffix rules allowed: `.example.com`) |
| `STORAGE_DIR` | Uploaded files root (named volume `/app/storage` in Docker) |
| `SESSION_TTL_HOURS`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES` | Session lifetime, brute-force throttling/lockout |
| `FORCE_SECURE_COOKIES` | Force `Secure` cookies (auto-detects HTTPS behind a proxy when empty) |
| `MIGRATE_ON_STARTUP` | Run pending Prisma migrations on container start (default `true`) |
| `SUPPORTDESK_IMAGE`, `APP_PORT` | Deployment-only: pinned image reference, published host port |

## HTTPS / domain setup (Caddy)

Point the DNS `A` record of your domain at the server, then bring up the Caddy overlay:

```bash
docker compose -f docker-compose.yml -f deploy/caddy/docker-compose.caddy.yml up -d
```

Caddy terminates TLS with automatic Let's Encrypt certificates; the app keeps serving plain HTTP on the internal network. Full details: [DEPLOYMENT.md](DEPLOYMENT.md).

## CI/CD pipelines

GitHub Actions runs the whole lifecycle — every change is verified, every release is reproducible, every deployment is health-gated and reversible.

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** (`ci.yml`) | push / PR to `main` | 4 jobs: `lint`, `typecheck`, `build` (standalone artifact verification) and `tests` — the four mandated suites (phase 4 concurrency, phase 5 file-hub security, phase 6 admin permission matrix, phase 7 production hardening) executed against a **live dev server** on a freshly migrated database |
| **Release** (`release.yml`) | tag `v*` | Verifies tag == `VERSION` file → builds the production image → publishes to **GHCR** with `X.Y.Z` / `X.Y` / `X` tags (no `:latest`, by design) |
| **Production Deploy** (`deploy.yml`) | manual (workflow_dispatch) | SSH deploy: backup → pull pinned tag → recreate → **health gate** → **automatic rollback on failure**; post-deploy version verification |
| **CodeQL** (`codeql.yml`) | push / PR / weekly | Static security analysis (`security-extended`) with results under *Security → Code scanning* |
| **Dependabot** (`dependabot.yml`) | weekly | npm + GitHub Actions + Docker image dependency updates as PRs (grouped minor/patch) |

Release process (maintainers):

```bash
# 1. bump VERSION (and package.json "version"), commit
git tag v0.9.1
git push origin main v0.9.1     # -> Release workflow builds & publishes the image
```

## Deploying via GitHub Actions

One-time setup (≈ 5 minutes), then every deployment is one click:

1. **Server** (once): install Docker, clone the repo, run `./scripts/supportdesk.sh install` so `/opt/zai-supportsystem` exists (adjust `GH_DEPLOY_PATH` below if you chose another folder).
2. **GitHub → Settings → Environments** → create `production` (optionally protect it with required reviewers).
3. **GitHub → Settings → Secrets and variables → Actions**:

| Name | Type | Value |
|---|---|---|
| `GH_DEPLOY_HOST` | Secret | Server IP / hostname |
| `GH_DEPLOY_USER` | Secret | SSH user |
| `GH_DEPLOY_SSH_KEY` | Secret | **Private** SSH key allowed to log in (`ssh-keygen -t ed25519`) |
| `GH_DEPLOY_PORT` | Variable | SSH port (optional, default `22`) |
| `GH_DEPLOY_PATH` | Variable | Deployment folder (optional, default `/opt/zai-supportsystem`) |

4. **Actions → Production Deploy → Run workflow** — leave *image tag* empty to deploy the version in `VERSION`, or type a specific tag (e.g. `0.9.0`).

The deployment runs with **zero repository permissions** (SSH secrets only), serializes concurrent deploys, takes a pre-deploy backup, and rolls back automatically if the health endpoint does not pass.

## Rollback

Three independent layers (see [BACKUP-RESTORE.md](BACKUP-RESTORE.md) for the full policy):

1. **Image rollback** — the CLI records the previous image before every `update` (`.deploy-state`):

   ```bash
   ./scripts/supportdesk.sh rollback
   ```

   Health-gated; if the previous image is also unhealthy, it says so loudly. *Caveat:* rollback does not downgrade the database schema — if a failed release applied incompatible migrations, restore data instead (layer 2).

2. **Data restore** — every `update` takes a consistent backup first:

   ```bash
   ./scripts/supportdesk.sh restore backups/supportdesk-backup-<stamp>.tar.gz
   ```

3. **GitHub re-deploy** — *Actions → Production Deploy* with the previous image tag.

## Backup & restore

```bash
./scripts/supportdesk.sh backup            # consistent archive: DB + storage + .env (brief downtime)
./scripts/supportdesk.sh restore <file>    # DESTRUCTIVE — replaces current data (asks YES)
```

Recommended schedule (server crontab, daily 02:30, keep 7):

```cron
30 2 * * * cd /opt/zai-supportsystem && ./scripts/supportdesk.sh backup
15 3 * * * ls -1t /opt/zai-supportsystem/backups/supportdesk-backup-*.tar.gz | tail -n +8 | xargs -r rm -f
```

Backups contain secrets — keep them on encrypted storage. پشتیبان‌گیری روزانه توصیه می‌شود.

## Upgrading

```bash
cd /opt/zai-supportsystem
./scripts/supportdesk.sh update 0.9.1     # backup -> pull -> deploy -> health gate
./scripts/supportdesk.sh rollback         # if anything looks wrong
```

Database migrations are versioned (Prisma `migrate deploy`) and applied automatically on container start — pending-only, never destructive.

## Security posture

- **Sessions**: server-side session store, hashed tokens, revocation on logout, TTL configurable.
- **RBAC**: deny-by-default permission checks server-side on every API route; role grants + per-user ALLOW/DENY overrides.
- **CSRF**: strict same-origin enforcement (`assertSameOrigin`) with proxy-chain tolerance + optional `APP_TRUSTED_ORIGINS` suffix rules; `SameSite=Lax` cookies.
- **Customer identity**: national IDs AES-256-GCM encrypted at rest with a keyed-HMAC lookup index; OTP verification before history access.
- **Uploads**: content-based MIME verification, extension allowlists, randomized storage keys outside the web root, authorized-download endpoints only, path-traversal guards, mandatory ClamAV semantics (fail-closed when configured).
- **Audit**: append-only audit log over all security-relevant actions (login, assignment, export, settings, storage).
- **Throttling/lockout**: per-IP login sliding window + account lockout with audit entries.
- **CI security**: CodeQL (`security-extended`) on every change + weekly, Dependabot, secret-free pipelines (dummy env only), branch protection on `main`.
- **Runtime**: non-root container (uid 1000), tini PID-1, no secrets baked into images, security headers + strict CSP, no-store on API responses.

Report vulnerabilities privately — do not open public issues for security problems (see [SECURITY.md](SECURITY.md)).

## Development

Prerequisites: [Bun](https://bun.sh) 1.x. SQLite — no external services.

```bash
bun install
cp .env.example .env
bunx prisma migrate deploy
bun run dev                    # http://localhost:3000 (logs -> dev.log)
```

```bash
bun run lint                   # eslint
bun run typecheck              # tsc --noEmit
bun scripts/test-phase4-concurrency.ts   # DB-level (dev server not needed)
bun scripts/test-phase5-security.ts
bun scripts/test-phase6-security.ts      # needs dev server on :3000
bun scripts/test-phase7-hardening.ts
```

In development, missing `AUTH_SECRET` / `SUPERADMIN_PASSWORD` fall back to deterministic dev values (with a loud warning). Production refuses to start without them. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow (branches, conventional commits, release process).

## Project structure

```
├── install.sh                  # one-click bootstrap (clone + wizard)
├── Dockerfile                  # multi-stage production image (non-root, healthcheck)
├── docker-compose.yml          # app service + named volumes (db, storage)
├── deploy/caddy/               # HTTPS overlay (automatic Let's Encrypt)
├── scripts/
│   ├── supportdesk.sh          # management CLI: install/update/rollback/backup/restore/status
│   ├── docker-entrypoint.sh    # env validation + migrate deploy + exec server
│   ├── bootstrap.ts / seed-demo.ts
│   └── test-phase4..7-*.ts     # mandated verification suites (CI runs these)
├── prisma/                     # schema + versioned migrations
├── src/
│   ├── app/                    # Next.js App Router (portal, staff, admin, API)
│   ├── lib/                    # env, auth/session, rbac, audit, storage drivers, RAG engine
│   └── components/             # shadcn/ui + app components
└── docs/                       # as-built deep dives (RAG engine, foundation audit)
```

## Troubleshooting

| Symptom | Diagnosis |
|---|---|
| Every mutation returns `403 ORIGIN_MISMATCH` | A proxy chain rewrites `Host`/`x-forwarded-host`. Add your host(s) to `APP_TRUSTED_ORIGINS` (suffix rules allowed, e.g. `.example.com`) and restart. |
| `Health check did not pass` after install/update | `./scripts/supportdesk.sh logs 200` — common causes: wrong `DATABASE_URL`, missing `SUPERADMIN_PASSWORD` on first bootstrap, port already in use (`APP_PORT`). |
| Login says locked | `LOGIN_MAX_ATTEMPTS` lockout (default 5 → 15 min) — wait or unlock via Super Admin. |
| Container restart loop | Entrypoint fails fast on invalid env; the log names the exact missing variable (values are never printed). |
| Need to move servers | `./scripts/supportdesk.sh backup` on the old host → clone repo on the new host → `./scripts/supportdesk.sh restore <file>`. |

## Documentation set

| Document | Scope |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modular monolith layout, layers, modules, request flows |
| [SECURITY.md](SECURITY.md) | Threat model, implemented controls, credential recovery |
| [PERMISSIONS.md](PERMISSIONS.md) | Permission catalog, role matrix, effective-permission algorithm |
| [DATABASE.md](DATABASE.md) | Schema reference, migration workflow, SQLite→PostgreSQL runbook |
| [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md) | RAG pipeline, provider adapter, corrective loop, evaluation |
| [KNOWLEDGE-BASE.md](KNOWLEDGE-BASE.md) | Collections, document pipeline, Q&A editor, retrieval semantics |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment guide (Docker, Caddy, bare-metal) |
| [BACKUP-RESTORE.md](BACKUP-RESTORE.md) | Backup & restore policy and procedures |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development + release workflow |
| [docs/foundation-audit/](docs/foundation-audit/) | Repository audit & reuse-first architecture analysis |

---

## License

Proprietary — © 2025 the repository owner. All rights reserved.
Use, modification and distribution are governed by separate written agreement with the owner.
