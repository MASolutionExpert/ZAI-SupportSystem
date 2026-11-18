# DATABASE.md — Support Desk

Status: Phase 4 schema (Prisma ORM 6, SQLite v1) — Phase 1 implemented by migration `20261115142728_init_phase1_foundation`; Phase 2 added `20261116053120_phase2_operator_availability` (`User.isAvailable`); Phase 3 added `20261116070919_phase3_kb_ai` (KB, conversations, retrieval records, AI usage logs, `Department.aiSettings`); Phase 4 added `20261116093322_phase4_tickets_portal` (customer profiles, identity verification records, tickets, ticket messages/attachments/status history, notifications, `Department.ticketSettings`, `Conversation.customerId`) and `20261116094650_phase4_ticket_nullable_customer` (ticket `customerId` nullable, `SetNull`). Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [BACKUP-RESTORE.md](BACKUP-RESTORE.md) (maintained separately).

## 1. Entity-relationship overview

```
                        ┌────────────┐
                        │    Role    │ key (PK)  SUPER_ADMIN | OPERATOR | FILE_MANAGER
                        └─────┬──────┘
              ┌───────────────┼───────────────────────┐
              │               │                       │
      RolePermission    User.roleKey          (custom roles: Phase 2+)
              │               │
        Permission           User ──────────────────────────────┐
         (52-key catalog)     │  │  │  │                        │
                              │  │  │  └─ Session[] (tokenHash, │
                              │  │  │     expiresAt, revokedAt)│
                              │  │  └──── AuditLog[] (actor)   │
                              │  └─────── UserPermissionOverride[]
                              └────────── DepartmentMembership[] ──┐
                                                                   │
                                                                Department
                                                                (public landing cards)
```

```
AuditLog  (actorType USER|SYSTEM|CUSTOMER, actorUserId → User, action,
           entityType/entityId, metadata JSON-in-String, ip, userAgent)

SystemSetting (key PK, value JSON-in-String, updatedBy, updatedAt)
              e.g. org.name — feeds the public landing page; ai.* from Phase 3
```

Phase 1 therefore has 10 models: `User`, `Role`, `Permission`, `RolePermission`, `UserPermissionOverride`, `Session`, `Department`, `DepartmentMembership`, `AuditLog`, `SystemSetting`.

---

## 2. Per-model reference

### User — staff accounts (super admin / managers / operators)

| Field | Type | Purpose |
|---|---|---|
| `id` | String (cuid), PK | Opaque identifier — the only user ID exposed to URLs/APIs |
| `username` | String, unique | Login name |
| `email` | String? | Optional contact address |
| `name` | String | Display name (Persian) |
| `passwordHash` | String | bcrypt hash, cost 12 — plaintext never stored |
| `roleKey` | String → Role.key | The user's single role (indexed) |
| `status` | String | `ACTIVE \| INACTIVE \| SUSPENDED` — validated in the app layer; indexed |
| `mustChangePassword` | Boolean | Forces `/change-password` (set on bootstrap-created super admin and admin resets) |
| `failedLoginAttempts` | Int | Lockout counter (reset on success) |
| `lockedUntil` | DateTime? | Account lockout expiry (5 failures → `LOGIN_LOCK_MINUTES`) |
| `lastLoginAt` | DateTime? | Successful-login timestamp |
| `createdAt` / `updatedAt` | DateTime | Timestamps |

### Role — system + (later) custom roles

| Field | Purpose |
|---|---|
| `key` | PK string: `SUPER_ADMIN`, `OPERATOR`, `FILE_MANAGER` (system) — custom roles later |
| `name` | Persian display name |
| `description` | Optional description |
| `isSystem` | System roles are seeded/managed by bootstrap, never deleted by UI |

### Permission / RolePermission / UserPermissionOverride — the RBAC core

| Model | Fields | Purpose |
|---|---|---|
| `Permission` | `key` (PK, e.g. `tickets.reply`), `category` (`ADMIN\|SUPPORT\|FILES\|KB\|AI`, indexed), `description` | The 52-key catalog; seeded by bootstrap |
| `RolePermission` | `roleKey` + `permissionKey` (composite PK), `assignedAt`; cascade deletes both sides | Which role holds which permission |
| `UserPermissionOverride` | `userId`, `permissionKey` (unique together), `effect` (`ALLOW\|DENY`), `note`, timestamps; indexed on `userId` | Per-user exceptions; DENY wins; indexed for the 30 s-cached effective-permission computation |

### Session — server-side revocable sessions

| Field | Purpose |
|---|---|
| `tokenHash` | SHA-256 of the 32-random-byte token; **unique**; the raw token is never stored |
| `userId` | Owner (indexed; cascade delete with user) |
| `ip` / `userAgent` | Recorded at creation for session review/audit |
| `expiresAt` | `SESSION_TTL_HOURS` (default 168) from creation; indexed for expiry sweeps |
| `revokedAt` | Set by logout / password change (revokes "all other sessions") |

### Department — support departments (drive the public landing page)

| Field | Purpose |
|---|---|
| `name` / `description` | Persian display strings on the public card |
| `iconKey` | Whitelisted lucide icon key (default `MessageCircle`) |
| `displayOrder` | Sort order on the landing page |
| `isActive` / `isPublic` | Only `isActive && isPublic` rows render publicly; deactivation preserves existing records |
| `aiEnabled` | AI assistant toggle per department (used from Phase 3) |
| `welcomeMessage` | Department-specific welcome message (used from Phases 3/4) |
| Composite index | `@@index([isActive, isPublic, displayOrder])` — exactly the landing-page query |

### DepartmentMembership — operator↔department scope

| Field | Purpose |
|---|---|
| `userId` + `departmentId` | Unique pair (cascade deletes); indexed on `departmentId` |
| `isManager` | Department manager flag (extra authority inside the department, Phase 2+) |
| `assignedAt` | Assignment timestamp |

### AuditLog — security & administration trail

| Field | Purpose |
|---|---|
| `actorType` | `USER \| SYSTEM \| CUSTOMER` (customers from Phase 4) |
| `actorUserId` / `actorLabel` | FK to User (SetNull on user deletion) + username snapshot that survives deletion; indexed on `actorUserId` |
| `action` | Dot-namespaced event (e.g. `auth.login.success`, `system.bootstrap.superadmin`); indexed |
| `entityType` / `entityId` | What the action touched |
| `metadata` | JSON-serialized string — **never contains secrets or raw PII** |
| `ip` / `userAgent` / `createdAt` | Context; indexed on `createdAt` |

### SystemSetting — key/value configuration store

| Field | Purpose |
|---|---|
| `key` | PK string, e.g. `org.name` (Phase 1), `ai.*` (Phase 3) |
| `value` | JSON-serialized value |
| `updatedBy` / `updatedAt` | Change accountability |

Phase 1 reads it through `src/lib/settings.ts` (in-process cache); secrets such as AI keys will be encrypted at rest when Phase 3 lands (see [SECURITY.md](SECURITY.md) §5).

---

## 3. Conventions

| Convention | Detail |
|---|---|
| IDs | `cuid()` strings everywhere — opaque, URL-safe, no sequential guessing |
| Timestamps | `createdAt @default(now())` + `updatedAt @updatedAt` on mutable models |
| Enum-like fields | Stored as `String` (SQLite/Prisma has no native enums) and validated at the application layer with Zod + TypeScript unions — e.g. `User.status`, `AuditLog.actorType`, `Permission.category`, `UserPermissionOverride.effect` |
| JSON payloads | Stored as serialized strings in clearly-named fields (`AuditLog.metadata`, `SystemSetting.value`) because SQLite has no native JSON type in Prisma; parsed/written only by the owning service module |
| Indexes | Declared where queries actually run: landing-page composite index, `Session.expiresAt`, `Session.tokenHash @unique`, audit `action`/`createdAt`/`actorUserId`, `User.roleKey`/`status`, department `isActive,isPublic,displayOrder` |
| Cascades | `onDelete: Cascade` for ownership graphs (sessions, memberships, overrides, role bindings); `onDelete: SetNull` for the audit actor FK so history survives user deletion |
| Keys never as PK | Customer national IDs (Phase 4) are never relational keys — see §6 |
| Relations | Foreign keys via Prisma relations; referential integrity is enforced at the database level |

---

## 4. Migration workflow

All schema changes go through **version-controlled migrations** — never `prisma db push`, never `prisma migrate reset` in production.

| Environment | Command | Notes |
|---|---|---|
| Development (iterating on `prisma/schema.prisma`) | `bunx prisma migrate dev --name <change>` (or `bun run db:migrate`) | Generates SQL under `prisma/migrations/`, applies it, regenerates the client |
| Development (first setup / CI) | `bun run db:deploy` | Applies existing migrations non-interactively |
| Production | `bun run db:deploy` (`prisma migrate deploy`) — also run automatically at startup when `MIGRATE_ON_STARTUP=true` (default) | Applies pending migrations only; never destructive |
| After schema edits | `bun run db:generate` if needed | Regenerate the Prisma client |

| Script | Safety |
|---|---|
| `db:deploy` | ✅ Production-safe |
| `db:migrate` | Development only (needs a shadow DB, may prompt) |
| `db:push` | ⚠️ Dev-only sync **with `--accept-data-loss`** — never production |
| `db:reset` | ⚠️ Drops the database — development only, never production |

Existing migration: `20261115142728_init_phase1_foundation` (creates all 10 Phase-1 tables and their indexes). Spec §15 rules apply: no destructive initialization on restart; demo data only via the explicit `bun run seed-demo` path against a development/verified-empty database.

### 4.1 Phase 4 SQLite runtime configuration (as-built)

The Phase-4 concurrency test surfaced a real operational requirement for SQLite: parallel write transactions over a multi-connection pool hit `SQLITE_BUSY`/pool timeouts. The shipped configuration is:

- `DATABASE_URL` carries **`?connection_limit=1`** — all queries serialize through one connection, which matches the single-node design and makes interactive transactions uncontended (deterministic, no lock errors). Scale-out deployments switch to PostgreSQL (§5), where pool sizing returns.
- The database file uses **WAL journal mode** (set once via `PRAGMA journal_mode=WAL`; persisted in the DB file — survive restarts). WAL adds durability and read/write concurrency headroom.
- At the application layer, assignment-affecting operations (ticket creation, auto-assign, transfer) serialize through an **in-process lock** (`withAssignmentLock`) so the `MAX(number)+1` allocation and load counting stay deterministic; this lock is the application-side counterpart of PostgreSQL row locks after the switch.

### 4.2 Reconciling a `db push`-provisioned database with the migration history (Phase 7 finding)

A database created with `prisma db push` has a schema but **no migration bookkeeping**. Do **not** "reconcile" it by resolving every migration as applied (`prisma migrate resolve --applied <name>`) and then running `prisma migrate deploy`. Reproduced and confirmed harmful in Phase 7: SQLite migrations generated for `ALTER TABLE` changes use the **table-rebuild pattern** (`CREATE TABLE "new_X" … INSERT … SELECT … DROP TABLE "X" … RENAME`). Re-running an *early* rebuild migration against an already-evolved schema recreates the table with the **early-era column set** and silently **drops columns added by later migrations** (e.g. phase 2's `new_User` rebuild drops phase 5's `User.storageQuotaBytes`). No error is raised — the data column simply disappears.

If a `db push`-built database must adopt the migration history:

1. **Take a backup first** (see BACKUP-RESTORE.md) — the procedure can go wrong.
2. `bunx prisma migrate diff --from-url <DATABASE_URL> --to-schema-datamodel prisma/schema.prisma` — verify the live schema actually matches the model (expected for a healthy push-built DB).
3. Resolve migrations as applied **without ever running `migrate deploy` afterwards on that database**, OR (recommended, small data volumes) create a **fresh database via `migrate deploy`** (bookkeeping-consistent from the first table) and re-import the data per the §5.2 export/import procedure.
4. Sanity-check `PRAGMA table_info('<table>')` for the newest columns of each phase before going live.

For the standard path — databases created by `migrate deploy` from scratch — none of this applies: bookkeeping and schema always agree, and re-running `migrate deploy` is a verified no-op ("No pending migrations").

---

## 5. SQLite → PostgreSQL switch runbook

The Phase-1 schema deliberately avoids SQLite-specific constraints, so models port unchanged. What changes is the provider line and (because the existing migration files contain SQLite-dialect SQL) the migration baseline on the PostgreSQL side.

### 5.1 Fresh PostgreSQL deployment (new installation)

1. Provision PostgreSQL and create a database, e.g. `supportdesk`.
2. Set the datasource in `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Set `DATABASE_URL` to the Postgres connection string in the environment (e.g. `postgresql://user:pass@host:5432/supportdesk`).
4. Re-baseline migrations for the new dialect: with the schema provider switched, run `bunx prisma migrate dev --name init_postgresql_baseline` against the fresh database **in development** to generate the PostgreSQL-dialect baseline, commit it to `prisma/migrations/`, and review the generated SQL. (Do **not** replay the old SQLite migration files against Postgres — the dialects differ.)
5. Apply in production with `bun run db:deploy`.
6. Run `bun run bootstrap` (roles/permissions/super admin) exactly as in a fresh install.

### 5.2 Existing SQLite deployment with data

Migrating live data is an **explicit export/import step**, documented and executed per deployment (a scripted path remains follow-up tooling — the Phase 6 admin panel ships reporting/settings/audit modules, not a migration wizard; until then the procedure is):

1. Stop the application; take a full backup (see [BACKUP-RESTORE.md](BACKUP-RESTORE.md)).
2. Export the SQLite data to a neutral interchange format (JSON rows per table — including JSON-in-String fields verbatim; cuid IDs are strings, so they survive round-trips).
3. Stand up PostgreSQL per §5.1 steps 1–5 (fresh schema).
4. Import the exported rows table by table, preserving IDs; verify counts and spot-check referential integrity (e.g. every `User.roleKey` resolves).
5. Re-run `bun run bootstrap` — it is idempotent: it re-syncs roles/permissions and skips the super admin if one exists (never overwrites).
6. Start the application against PostgreSQL and verify `GET /api/health` plus `/api/admin/system-status` counts before decommissioning the SQLite file (keep it archived per backup policy).

### 5.3 Revisit triggers (from [ARCHITECTURE.md](ARCHITECTURE.md) D1)

Multi-node deployment, high write concurrency, PostgreSQL full-text search for the knowledge base, row-level locking for the fair ticket-assignment engine, or JSONB querying — realistically Phase 3+ scale.

---

## 6. Customer identity modeling (Phase 4 — **implemented**)

The national ID (کد ملی) is the customer identity attribute, but it is **never** a relational key and **never** exposed. As built in Phase 4:

- Stored **encrypted** in `CustomerProfile.nationalIdEnc` with app-level AES-256-GCM (`enc.v1` envelope); the key derives from `APP_ENCRYPTION_KEY` (fallback `AUTH_SECRET`) — environment, outside the DB.
- Lookups use `CustomerProfile.nationalIdHmac` — a **keyed HMAC-SHA256** index column (unique) — equality search without exposing the raw value. The HMAC key is a domain-separated scrypt subkey, so it cannot be confused with the encryption key.
- Never a primary key, never in URLs, logs, public APIs, error messages, or operator-facing lists (operators see `maskNationalId`: the last 3 digits only).
- Modeled as a separate `CustomerProfile` entity; one customer holds tickets across departments. `Ticket.customerId` is nullable (`SetNull` on profile deletion); chat-handoff tickets from citizen-linked conversations carry the profile (Phase 8).
- **Phase 8 change — password accounts replace OTP/SMS**: citizens authenticate with کد ملی + password. The password is set at FIRST contact (portal ticket form or the live-chat identity step); returning citizens must supply it. Fields: `CustomerProfile.passwordHash` (bcrypt cost 12, nullable for legacy Phase-4 rows that set a password on next contact), `status` (`ACTIVE` | `BLOCKED`, superadmin-managed), `mustChangePassword` (informational flag after a superadmin reset; cleared on self-service change), `lastLoginAt`. The OTP model `IdentityVerificationRecord` and the `isVerified`/`lastVerifiedAt` columns were removed (SMS verification discontinued by product decision). Portal access still issues the short-lived HMAC-signed httpOnly session cookie — access state is never a DB flag; every read re-resolves the signed cookie.
- Superadmin management (`کاربران سامانه`, `/admin/citizens`): edit name, reset password (plaintext returned once, never stored/audited), block/unblock, delete (tickets/conversations preserved via `SetNull`). Search accepts a full national ID and resolves it through the HMAC index without ever displaying it.
- Server-side checksum validation (`validateNationalId`) normalizes Persian/Arabic digits and rejects invalid IDs with a uniform message that never echoes the raw value.

---

## 7. Backup pointers

SQLite v1 means the database is **one file** (`DATABASE_URL`, e.g. `file:./db/custom.db`): backup = consistent file copy (with the app stopped or using SQLite's backup semantics), restore = file replace. Storage files (from Phase 5) live outside the DB in `STORAGE_DIR` and are backed up alongside. Full procedures, schedules, and restore drills: [BACKUP-RESTORE.md](BACKUP-RESTORE.md).

---

## 8. Roadmap — Phase 2+ entities (from master spec §12)

The normalized schema is extensible; these entities arrive with their phases (names are conceptual — final Prisma models are created via migrations in each phase):

| Phase | Planned entities |
|---|---|
| 2 | Extensions to roles/membership management (custom roles, operator availability) |
| 3 | `knowledge_collections`, `knowledge_documents`, `knowledge_document_versions`, `knowledge_chunks`, `knowledge_qa_entries`, `knowledge_retrieval_records`, `ai_provider_settings`, `ai_department_settings`, `ai_usage_logs` — see [KNOWLEDGE-BASE.md](KNOWLEDGE-BASE.md) / [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md) |
| 4 | **Implemented** — `customer_profiles` (encrypted national ID + HMAC index), `identity_verification_records`, `tickets` (nullable customer ref for chat-handoff), `ticket_messages` (internal-note flag), `ticket_attachments`, `ticket_status_history`, `notifications`, `Department.ticketSettings` |
| 5 | `file_folders`, `stored_files`, `file_permissions`, `storage_quotas` |
| 6 | Reporting reads over the above; no new core entities expected |

Design constraints carried forward: proper foreign keys, indexes, constraints, and transaction boundaries; no unnecessary multi-tenant complexity in v1; customer identity independent from tickets; no duplicate personal data.
