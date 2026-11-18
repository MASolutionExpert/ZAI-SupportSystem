# DATABASE.md — Support Desk

Status: **PostgreSQL data layer (Prisma ORM 6) since v0.10.0** — single baseline migration `20261119000000_init_postgresql` created from the schema (37 models). Historical note: v0.9.x and earlier shipped on SQLite with seven SQLite-dialect migrations (`20261115142728_init_phase1_foundation` … `20261118090000_phase8_citizen_accounts`); those files were retired with the re-baseline (see §5). — Phase 1 implemented by migration `20261115142728_init_phase1_foundation`; Phase 2 added `20261116053120_phase2_operator_availability` (`User.isAvailable`); Phase 3 added `20261116070919_phase3_kb_ai` (KB, conversations, retrieval records, AI usage logs, `Department.aiSettings`); Phase 4 added `20261116093322_phase4_tickets_portal` (customer profiles, identity verification records, tickets, ticket messages/attachments/status history, notifications, `Department.ticketSettings`, `Conversation.customerId`) and `20261116094650_phase4_ticket_nullable_customer` (ticket `customerId` nullable, `SetNull`). Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [BACKUP-RESTORE.md](BACKUP-RESTORE.md) (maintained separately).

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

### 4.1 PostgreSQL runtime configuration (as-built, v0.10.0)

- **Connection URL**: plain `postgresql://…?schema=public` — no `connection_limit` parameter. Prisma's default pool (`num_cpus * 2 + 1`) is correct for PostgreSQL row locking; the SQLite-era single-connection serialization is gone.
- **Docker wiring**: Compose builds `DATABASE_URL` from `POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB` and injects it into the app container (db service: `postgres:16-alpine`, healthcheck `pg_isready`, volume `supportdesk_pgdata`).
- **Ticket numbering**: `MAX(number)+1` inside the creation transaction plus a **unique constraint** on `Ticket.number`; under concurrent creation the loser gets P2002 and the retry loop re-reads the maximum with jittered backoff. The in-process `withAssignmentLock` remains as a same-instance optimization; cross-instance correctness comes from the constraint + retry.
- **Case sensitivity**: PostgreSQL `LIKE` is case-sensitive — all user-facing `contains`/`startsWith` searches pass `mode: "insensitive"` to preserve the SQLite-era behavior.
- **Local development without Docker**: `bun run db:up` boots a real PostgreSQL via `embedded-postgres` (official binaries, data in gitignored `db/pgdata/`, port 5433).

### 4.2 Reconciling a `db push`-provisioned database with the migration history (Phase 7 finding)

A database created with `prisma db push` has a schema but **no migration bookkeeping**. Do **not** "reconcile" it by resolving every migration as applied (`prisma migrate resolve --applied <name>`) and then running `prisma migrate deploy` — bookkeeping and real schema can silently disagree. Historical note: on SQLite this was confirmed harmful (the table-rebuild migration pattern dropped later-era columns on replay); PostgreSQL migrations use plain `ALTER TABLE`/`CREATE INDEX` so the worst case is a failing migration rather than silent data loss, but the rule stands. If a push-built database must adopt the history, take a backup and recreate it fresh via `migrate deploy`, then re-import the data.

If a `db push`-built database must adopt the migration history:

1. **Take a backup first** (see BACKUP-RESTORE.md) — the procedure can go wrong.
2. `bunx prisma migrate diff --from-url <DATABASE_URL> --to-schema-datamodel prisma/schema.prisma` — verify the live schema actually matches the model (expected for a healthy push-built DB).
3. (Recommended) create a **fresh database via `migrate deploy`** (bookkeeping-consistent from the first table) and re-import the data.

For the standard path — databases created by `migrate deploy` from scratch — none of this applies: bookkeeping and schema always agree, and re-running `migrate deploy` is a verified no-op ("No pending migrations").

---

## 5. The v0.10.0 PostgreSQL re-baseline (completed)

The switch executed in v0.10.0 followed exactly the planned re-baseline:

1. `prisma/schema.prisma` datasource switched to `provider = "postgresql"` (models unchanged — the schema was written provider-portable from day one).
2. The seven SQLite-dialect migrations were **retired** (they cannot replay against PostgreSQL) and replaced by a single offline-generated baseline: `bunx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` → `prisma/migrations/20261119000000_init_postgresql/migration.sql` + `migration_lock.toml` (`provider = "postgresql"`).
3. Fresh deployments apply it with `prisma migrate deploy` (compose entrypoint runs it automatically on first start; CI applies it against the PostgreSQL service container).

**Migrating an existing v0.9.x (SQLite) deployment with data** is an explicit export/import (one-time; scripted tooling is follow-up work):

1. Keep the old v0.9 stack stopped and archived (its SQLite file is the source of truth until the cut-over succeeds).
2. Deploy v0.10.0 per DEPLOYMENT.md (fresh PostgreSQL via `migrate deploy` + `bootstrap`).
3. Export the SQLite rows to JSON per table (cuid IDs are strings, JSON-in-String fields copy verbatim) and import them table by table, preserving IDs; verify counts and referential integrity (e.g. every `User.roleKey` resolves).
4. Re-run `bun run bootstrap` (idempotent — re-syncs roles/permissions, never overwrites data) and verify `GET /api/health` plus admin report counts before decommissioning the archived file.
   v0.9 backups (`db/*.db` file archives) cannot be restored into PostgreSQL via `supportdesk restore` — they are source material for step 3 only.

### 5.3 Revisit triggers (from [ARCHITECTURE.md](ARCHITECTURE.md) D1)

pgvector for the RAG index (the `createVectorIndex()` factory seam already isolates the in-memory JSON scorer), PostgreSQL full-text search for the knowledge base, external rate-limiting in Redis for multi-replica deployments, JSONB querying for the JSON-in-String fields.

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

The database is **PostgreSQL** (`supportdesk_pgdata` volume): backup = `pg_dump --format=custom` snapshot (online, MVCC-consistent — `./scripts/supportdesk.sh backup` wraps it together with the storage volume and `.env`), restore = `pg_restore --clean --if-exists`. Storage files live outside the DB in `STORAGE_DIR` and are backed up alongside. Full procedures, schedules, and restore drills: [BACKUP-RESTORE.md](BACKUP-RESTORE.md).

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
