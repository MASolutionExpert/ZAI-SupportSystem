# ARCHITECTURE.md — Support Desk

Status: Phase 1 (Foundation & Deployment) — describes **what is implemented now** and the **planned integration points** for later phases. Companion docs: [SECURITY.md](SECURITY.md), [PERMISSIONS.md](PERMISSIONS.md), [DATABASE.md](DATABASE.md), [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md), [KNOWLEDGE-BASE.md](KNOWLEDGE-BASE.md).

---

## 1. Topology — modular monolith

One Next.js process, one SQLite database file (v1), one local-disk storage directory. Every capability lives in its own module under `src/`; later phases add modules inside the same process rather than new services.

```
                ┌────────────────────────────────────────────────────────────┐
                │                     support.example.com                    │
                │                (reverse proxy / TLS terminates here)       │
                └───────────────────────────────┬────────────────────────────┘
                                                │ HTTP(S)
┌───────────────────────────────────────────────▼────────────────────────────────────────────────┐
│ Next.js 16 App Router (single process — modular monolith)                                      │
│                                                                                                │
│  ┌── Pages (Persian RTL) ─────────────┐   ┌── API route handlers ──────────────────────────┐   │
│  │ /            public landing        │   │ /api/health              public 200/503        │   │
│  │ /login         staff login         │   │ /api/auth/*     login/logout/session/password  │   │
│  │ /change-password  forced change    │   │ /api/admin/system-status   admin.dashboard.view│   │
│  │ /admin         admin/operator shell│   │ (future: /api/tickets, /api/files, /api/kb …)  │   │
│  └──────────────┬─────────────────────┘   └──────────────────┬─────────────────────────────┘   │
│                 │ server components also guard               │                                 │
│                 ▼                                            ▼                                 │
│  ┌─────────────────────────── service modules (src/lib) ───────────────────────────────────┐   │
│  │ env.ts        Zod-validated environment (fails fast on bad config)                      │   │
│  │ db.ts         Prisma client singleton                                                   │   │
│  │ auth/*        password.ts · session.ts · throttle.ts                                    │   │
│  │ rbac/*        permissions.ts (catalog) · service.ts (effective permissions)             │   │
│  │ audit.ts      audit log writer                                                          │   │
│  │ settings.ts   SystemSetting key/value JSON store with cache                             │   │
│  │ api.ts        response envelope · same-origin (CSRF) check · requireAuth/Permission     │   │
│  │ bootstrap.ts  idempotent startup seed (roles, permissions, initial Super Admin)         │   │
│  │ storage.ts    local-disk storage abstraction stub (S3-compatible path later)            │   │
│  │ (future: tickets/, files/, kb/, ai/ …)                                                  │   │
│  └──────────────────────────────────────────┬──────────────────────────────────────────────┘   │
│                                             ▼                                                  │
│  ┌── Prisma ORM 6 ────────────┐   ┌── SQLite (v1) ─────┐   ┌── Local disk ──────────────────┐  │
│  │ src/lib/db.ts singleton    │──▶│ prisma/dev.db      │   │ STORAGE_DIR (stub, Phase 5)    │  │
│  │ parameterized queries only │   │ one-file backup    │   │ public/fonts (bundled assets)  │  │
│  └────────────────────────────┘   └────────────────────┘   └────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Layer map

```
app routes (pages & server components)
        │  render with session context; server components call guards too
        ▼
API route handlers (src/app/api/**)            ── thin: parse → validate → delegate
        │  src/lib/api.ts envelope + same-origin check + requireAuth / requirePermission
        ▼
service modules (src/lib/**)                   ── all business rules & authorization
        │
        ▼
Prisma client (src/lib/db.ts)                  ── the only code that touches SQL
        │
        ▼
SQLite database file / local disk storage
```

Rules that hold at every layer:

- **Deny by default.** Authorization is enforced in backend guards (API route handlers *and* server components), never by hiding UI elements.
- **No business logic in route handlers.** They validate with Zod, call a service module, and return the shared response envelope.
- **No direct DB access from pages.** Server components read through services, same as API handlers.

---

## 2. Modules (implemented in Phase 1)

| Module | Responsibility |
|---|---|
| `src/lib/env.ts` | Parses and validates all environment variables with Zod at startup; the process fails fast on bad config instead of misbehaving later. |
| `src/lib/db.ts` | Prisma client singleton (one instance per process). All queries are parameterized by the ORM. |
| `src/lib/auth/password.ts` | Password hashing/verification with bcryptjs, cost 12. |
| `src/lib/auth/session.ts` | Creates, validates, and revokes server-side sessions; handles the `sd_session` cookie. Tokens are 32 random bytes; the DB stores only their SHA-256 hash. Enforces `SESSION_TTL_HOURS` expiry and `revokedAt`. |
| `src/lib/auth/throttle.ts` | In-memory sliding-window limiter (login: 10/min per IP) plus persistent account lockout via `User.failedLoginAttempts` / `User.lockedUntil` (5 failures → lock `LOGIN_LOCK_MINUTES`, default 15). |
| `src/lib/rbac/permissions.ts` | The permission catalog constants (52 keys across ADMIN/SUPPORT/FILES/KB/AI) — single source of truth. |
| `src/lib/rbac/service.ts` | Effective permissions = role bindings ∪ user overrides (ALLOW/DENY; DENY wins; deny-by-default). Result cached 30 s. |
| `src/lib/audit.ts` | Writes `AuditLog` rows (actor, action, entity, metadata JSON, ip, userAgent). Never logs secrets or raw PII. |
| `src/lib/settings.ts` | Reads/writes `SystemSetting` key/value JSON rows with an in-process cache; e.g. `org.name` drives the public landing page. |
| `src/lib/api.ts` | API response envelope (consistent success/error shape), same-origin enforcement for mutating requests (CSRF strategy), `requireAuth` / `requirePermission` guards. |
| `src/lib/bootstrap.ts` | Idempotent startup: seeds system Roles + the full Permission catalog + binds them; re-syncs SUPER_ADMIN bindings so new permissions arrive with upgrades; creates the initial Super Admin from `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD` **only if no super admin exists** (never overwrites; forces password change on first login; audits `system.bootstrap.*`). |
| `src/instrumentation.ts` | Runs `bootstrap.ts` once per server start when `BOOTSTRAP_ON_STARTUP=true` (default). |
| `src/lib/storage.ts` | Storage abstraction: `StorageDriver` interface (`put/get/delete/stat`) with the local-disk driver rooted at `STORAGE_DIR`, plus the canonical `resolveInsideStorageRoot` path-traversal guard and root usage accounting. An S3-compatible driver can replace the local one without touching callers (ARCHITECTURE §6 as-built). |
| `src/lib/files/*` | Phase 5 shared file hub: `types.ts` (defaults/limits/view types), `mime.ts` (content-based MIME verification — magic bytes/text rules; allowlist can only restrict), `scan.ts` (ClamAV clamd INSTREAM client with mandatory-scan semantics), `settings.ts` (`storage.global` capacities/quotas/allowlist + `storage.av`, defensive parsing, save-time quota-chain validation), `service.ts` (department-scoped listing, nested folders with cycle guards, all-or-nothing batch upload with cumulative quota checks and blob rollback, authorized download, version-bumping replace, move/rename/delete, usage report — every mutation audited). |

---

## 3. Request / auth sequences

### 3.1 Login (`POST /api/auth/login`)

```
Browser                  /api/auth/login              src/lib/auth/*            Prisma (SQLite)
   │  POST {username,password}  │                            │                        │
   │───────────────────────────▶│                            │                        │
   │                            │ same-origin check (api.ts) │                        │
   │                            │ Zod: validate body         │                        │
   │                            │ throttle.check(ip)         │                        │
   │                            │  ── sliding window 10/min ─┼─▶ 429 on excess        │
   │                            │                            │                        │
   │                            │  find user by username ────────────────────────────▶ │
   │                            │  ◀───────────────────────────────────── User row ────│
   │                            │  account locked? lockedUntil > now → rejected with   │
   │                            │  a rate-limit-style Persian error (throttle.ts)      │
   │                            │  bcrypt.compare(password, passwordHash)  (cost 12)   │
   │                            │  on fail:                                            │
   │                            │    failedLoginAttempts+1 → lock at LOGIN_MAX_ATTEMPTS│
   │                            │    audit the failure (audit.ts)                      │
   │                            │  on success:                                         │
   │                            │    reset attempts, lastLoginAt, audit the login      │
   │                            │    (e.g. auth.login.success — audit.ts)              │
   │                            │    session.create():                                 │
   │                            │      token = 32 random bytes                         │
   │                            │      Session{ tokenHash = SHA-256(token), expiresAt =│
   │                            │                now + SESSION_TTL_HOURS, ip, userAgent}
   │◀───────────────────────────│  200 { mustChangePassword, user }                    │
   │◀─ Set-Cookie: sd_session (httpOnly, SameSite=Lax, Secure when TLS)                │
```

If `mustChangePassword` is `true`, the UI routes the user to `/change-password` before anything else.

### 3.2 Authenticated admin API call (`GET /api/admin/system-status`)

```
Browser                  /api/admin/system-status     rbac/service.ts           Prisma (SQLite)
   │  GET + sd_session cookie   │                            │                        │
   │───────────────────────────▶│                            │                        │
   │                            │ requireAuth():             │                        │
   │                            │  hash cookie token SHA-256 ┼── lookup Session ─────▶│
   │                            │  check revokedAt/expiresAt │   by tokenHash (unique)│
   │                            │  load user; status ACTIVE? │                        │
   │                            │ requirePermission(         │                        │
   │                            │   "admin.dashboard.view"): │                        │
   │                            │  role bindings ∪ overrides ┼── 1–2 queries, cached ─▶│
   │                            │  DENY wins; deny-by-default│   30 s (rbac cache)    │
   │                            │  no permission → 403 + audit the denial (audit.ts)   │
   │                            │  has permission:                                     │
   │                            │  collect: version (VERSION file), uptime,            │
   │                            │  DB reachability check, counts of users /            │
   │                            │  departments / activeSessions, storage usage         │
   │◀───────────────────────────│  200 envelope { data … }   │                        │
```

The same guard pair (`requireAuth` → `requirePermission`) is used by server components, so `/admin` renders from identical authorization rules as the APIs.

---

## 4. Key decisions

| # | Decision | Alternatives considered | Rationale | Revisit trigger |
|---|---|---|---|---|
| D1 | **Prisma ORM 6 + SQLite (v1)** instead of the master spec's preferred PostgreSQL + Drizzle ORM | PostgreSQL + Drizzle Kit (spec §2) | The delivery environment standardizes on Prisma. SQLite keeps the v1 single-node deployment radically simple: one-file DB backup, zero extra services — and the spec itself forbids unnecessary infrastructure. The schema deliberately avoids SQLite-specific constraints, so switching providers is a one-line `datasource` change + `prisma migrate` (runbook: [DATABASE.md](DATABASE.md)). | Multi-node deployment, high write concurrency, need for Postgres full-text search / row-level locking / JSONB — i.e., effectively Phase 3+ scale, per the runbook. |
| D2 | **Custom DB-backed session auth** instead of Better Auth (spec §2) | Better Auth | Full control over the required security features: server-side revocable sessions, forced password change on first login, login throttling/lockout, and direct audit integration. The custom surface is small (password + session + throttle) and auditable end-to-end; no framework abstraction sits between the security code and the audit log. | If a future requirement (e.g., OAuth/SSO, WebAuthn) would mean reimplementing large framework-grade features — evaluate migrating then, keeping the `Session` table contract. |
| D3 | Session tokens stored **only** as SHA-256 hashes | Storing raw tokens | A DB leak cannot be replayed into valid sessions; logout/revocation is server-side. | — |
| D4 | **In-memory** login rate limiter + DB-persisted account lockout | Redis-backed limiter | Single-node v1: the in-memory sliding window needs no extra service; the lockout survives restarts because it lives in `User.failedLoginAttempts`/`lockedUntil`. | Multi-node deployment (limiter must become shared) — same trigger as D1. |
| D5 | RBAC enforced in **backend guards**, catalog-driven | Frontend-only checks; role-name-based checks | Spec §9.4/§10 require server-side deny-by-default authorization. No permission is ever implied by a role name — every check consults the catalog (`src/lib/rbac/permissions.ts`). | — |
| D6 | Bootstrap is **idempotent and non-destructive** | Recreate admin on every start | Spec §9.1/§15: a redeploy must never overwrite existing data or credentials. SUPER_ADMIN permission bindings are the only thing re-synced (so upgrades add permissions). | — |
| D7 | Local-disk storage **abstraction stub** now, real implementation in Phase 5 | Full S3 integration immediately | Defines the seam (`storage.ts`) early so Phase 5 uploads and any later S3-compatible backend drop in without changing callers. | Phase 5 implementation; S3 path if object storage is required. |
| D8 | Zod validation at **every** boundary (env, HTTP bodies) | Ad-hoc checks | One validation vocabulary; `env.ts` fails fast on misconfiguration. | — |

---

## 5. Conventions

- **Persian RTL everywhere**: `lang="fa" dir="rtl"`, Vazirmatn bundled locally (`public/fonts/`). UI strings are Persian; not-yet-built modules show honest chips («فعال در فازهای بعدی») rather than fake controls (spec §11).
- **API envelope**: all handlers return one consistent success/error shape via `src/lib/api.ts`; mutating endpoints require a same-origin request (plus SameSite=Lax cookies).
- **String enums + JSON-in-String**: SQLite has no native Prisma enums/JSON — status/type fields are `String` validated by Zod + TS unions at the app layer; JSON payloads live in clearly-named serialized fields (`AuditLog.metadata`, `SystemSetting.value`). See [DATABASE.md](DATABASE.md).
- **Migrations only**: every schema change is a version-controlled migration (`prisma migrate dev` in development, `prisma migrate deploy` in production). Initial migration: `prisma/migrations/20261115142728_init_phase1_foundation`.
- **Version**: lives in the `VERSION` file (`0.1.0`), optionally overridden by `APP_VERSION`, reported by `GET /api/health`.

---

## 6. Future-phase integration points (designed seams, not yet implemented)

| Seam | Where it plugs in | Notes |
|---|---|---|
| **AI provider adapter** (Phase 3) | New `src/lib/ai/` module behind an OpenAI-compatible adapter (configurable Base URL / API Key / chat & embedding model, test-connection, masked keys). Credentials will live encrypted in `SystemSetting`/AI settings, never in env-committed code; details in [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md). | Ticketing/KB modules must stay provider-agnostic (spec §6.2). |
| **RAG pipeline** (Phase 3) | Retrieval service called before any AI answer: department-scoped retrieval from the knowledge base → confidence threshold → answer with citations or abstain with the exact spec fallback message; retrieval records stored for audit. Design in [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md) / [KNOWLEDGE-BASE.md](KNOWLEDGE-BASE.md). | Keyword/full-text first; embeddings optional later. |
| **File storage S3 path** (Phase 5 — as-built) | The `StorageDriver` interface in `src/lib/storage.ts` is the seam: swap the local driver for an S3-compatible implementation; callers (file hub services, quota checks, download endpoints) do not change. Files stay outside the web root and outside the relational DB (spec §8.3). Phase 5 ships the shared file hub on this driver; ticket attachments and KB documents still use their dedicated Phase-3/4 stores (ROADMAP §6 limitations). | Authorized backend download endpoints only; never public static paths. |
| **Department scoping** (Phase 2) | `DepartmentMembership` + `tickets.view.department` / `files.department.manage` style permissions give per-department data scoping on top of the existing RBAC guard pair. Examples in [PERMISSIONS.md](PERMISSIONS.md). | Enforced in services, not UI. |
| **Customer identity** (Phase 4) | Modeled separately with app-level AES-256-GCM encryption (`APP_ENCRYPTION_KEY` stored outside the DB) + keyed HMAC (SHA-256) lookup index — never a primary key, never exposed in URLs/logs/APIs. See [SECURITY.md](SECURITY.md). | OTP verification before history access. |

---

## 7. Dependency inventory (Phase 1 runtime)

| Dependency | Role |
|---|---|
| `next` 16 (App Router) + `react`/`react-dom` 19 | Framework and UI runtime |
| `@prisma/client` + `prisma` 6 | ORM, migrations, client generation |
| `bcryptjs` 3 | Password hashing (cost 12) |
| `zod` 4 | Input & environment validation |
| `tailwindcss` 4 + `tw-animate-css` | Styling (RTL-aware) |
| shadcn/ui components (New York) on Radix primitives | UI component system |
| `lucide-react` | Icons (whitelisted map for department icons) |
| Vazirmatn (local woff2 in `public/fonts/`) | Persian typography |
| Bun | Dev & production runtime for the scripts/build |

Full list in [package.json](package.json). Dependencies stay minimal per spec §15; new libraries are added only with a documented reason.
