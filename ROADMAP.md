# ROADMAP.md — Support Desk

Status: living document — maintained at the end of each phase per the master spec (§14/§16). Phase tables are copied/adapted from the master specification's phased plan. Companion docs: [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DEPLOYMENT.md](DEPLOYMENT.md), [BACKUP-RESTORE.md](BACKUP-RESTORE.md).

---

## 1. Phase overview

| Phase | Scope | Status |
|---|---|---|
| 1 — Foundation & Deployment | App shell, auth, RBAC, audit, bootstrap, public landing, health/status, deployment & backup groundwork | ✅ Delivered (v0.1.0) |
| 2 — Departments, Operators & Permissions | Management UIs, department memberships, backend scoping | ✅ Delivered (v0.2.0) |
| 3 — Knowledge Base & AI Integration | KB + strictly grounded AI assistant | ✅ Delivered (v0.3.0) |
| 4 — Customer Portal & Ticketing | Identification, OTP, ticketing, fair distribution | ✅ Delivered (v0.4.0) |
| 5 — Shared File Hub | Files, folders, quotas, storage management | ✅ Delivered (v0.5.0) |
| 6 — Super Admin & Reporting | Full control panel, reports, audit viewer | ✅ Delivered (v0.6.0) |
| 7 — Production Hardening | Security/upgrade/performance testing | ✅ **This delivery** (v0.7.0) — **all phases complete** |

Rule carried from the spec (§14/§15): no phase starts while critical tests of the current phase fail, and every phase ends with the §16 report (what was implemented, packages/decisions, migrations, tests run/passed/failed, remaining security concerns, exact run/deploy commands).

---

## 2. Phase 1 — Foundation & Deployment ✅

**Delivered:** Next.js 16 App Router + TypeScript (strict) modular monolith; Prisma 6 + SQLite (v1) with migration `20261115142728_init_phase1_foundation`; custom DB-backed session auth (bcrypt cost 12, SHA-256-hashed tokens, revocable); login throttling + account lockout; deny-by-default RBAC (52-key catalog, 3 system roles, per-user ALLOW/DENY overrides, 30 s cache); audit logging; Zod-validated environment; idempotent bootstrap (`BOOTSTRAP_ON_STARTUP=true` default) seeding roles/permissions/super admin; public landing page with DB-driven department cards; `/login`, `/change-password`, `/admin` (RTL shell, real session + system status, honest «فعال در فازهای بعدی» chips); `GET /api/health`, `/api/auth/*`, `GET /api/admin/system-status`; security headers; local-disk storage abstraction stub.

**Acceptance criteria checklist (master spec §14, Phase 1):**

- [x] The project runs locally (`bun run dev` after `bun run db:deploy` + `bun run bootstrap` — see [README.md](README.md) quick start)
- [x] A clean installation works end-to-end (deployment path documented in [DEPLOYMENT.md](DEPLOYMENT.md))
- [x] The database initializes correctly (single idempotent migration; `MIGRATE_ON_STARTUP=true` applies pending migrations at startup)
- [x] The first Super Admin is created securely (env-configured bootstrap credentials, hashed with bcrypt, forced first-login password change, audited `system.bootstrap.*`)
- [x] A fresh deployment does not overwrite existing data (bootstrap refuses to recreate/overwrite an existing super admin; migrations are non-destructive)
- [x] The application survives restarts (state lives in the DB file + env; bootstrap is idempotent; sessions/lockout state persist)
- [x] A documented update and backup process works ([DEPLOYMENT.md](DEPLOYMENT.md), [BACKUP-RESTORE.md](BACKUP-RESTORE.md))

**Deviations from the spec's preferred stack (documented in [ARCHITECTURE.md](ARCHITECTURE.md) §4):** Prisma + SQLite instead of PostgreSQL + Drizzle; custom session auth instead of Better Auth — both with rationale and revisit triggers.

---

## 3. Phase 2 — Departments, Operators & Permissions ✅

**Delivered:**

- **Department management** (`/admin/departments`, permission `admin.departments.manage`): create/edit, activate/deactivate, public visibility, per-department AI toggle, welcome message, description, whitelisted icon picker, display order with persisted reordering (`department.reorder`), guarded delete (only unassigned departments). Changes land on the public landing page immediately — no redeploy (spec 3.1).
- **Operator management** (`/admin/users`, permission `admin.users.manage`): create accounts (password policy enforced server-side), edit profile/role, activation/suspension (with session revocation), credential reset (generated or manual — one-time display, `mustChangePassword` flag, all sessions revoked, audited), department memberships with manager flags, per-operator availability switch (`User.isAvailable`, consumed by the Phase 4 fair-distribution engine), workload/activity view (last login, active sessions, recent audit events via `GET /api/admin/users/[id]/activity`).
- **Roles & permissions** (`/admin/roles`, permissions `admin.roles.manage` / `admin.permissions.manage`): custom role CRUD (system roles protected), per-role permission bindings editor (SUPER_ADMIN bindings locked to full catalog), per-user ALLOW/DENY overrides editor with role-grant indicators and instant cache invalidation.
- **Backend enforcement**: every endpoint guarded by `requirePermission` + same-origin checks; department scoping layer `src/lib/rbac/scope.ts` (`resolveDepartmentScope`, `hasDepartmentAccess`, `listDepartmentsInScope`) implementing PERMISSIONS.md §6 — capability from permissions, scope from memberships; used by the workspaces and ready for Phase 4/5 data access.
- **Operator workspace navigation**: the two workspaces «میز پشتیبانی» (`/support`, gated by `tickets.view`) and «فایل‌های مشترک» (`/files`, gated by `files.access`) are navigable with permission-filtered sidebar navigation, workspace tabs, real scoped-department and permission data, and self-service availability toggle (`POST /api/staff/availability`, audited).
- **Protection rules (server-enforced)**: no self role/status change; the last ACTIVE SUPER_ADMIN cannot be suspended/demoted; SUPER_ADMIN bindings immutable; system roles not editable/deletable; custom role keys cannot collide with reserved keys; roles with bound users cannot be deleted; departments with members cannot be deleted.

**Acceptance criteria (master spec §14, Phase 2):**

- [x] Department management UI with full parity to the public landing data (create/edit, activate/deactivate, order, icons, descriptions, public visibility, AI toggle)
- [x] Creating and activating a department in the panel makes it appear on the public landing page without redeployment (verified end-to-end in browser)
- [x] Operator management: accounts, activation/suspension, credential resets, department & role assignment, availability, workload/activity views
- [x] Role & permission management: custom roles, bindings, per-user overrides
- [x] Department memberships with manager flag
- [x] Backend authorization on all new endpoints (guards + scoping; deny-by-default)
- [x] Cross-department access restrictions: scope resolution is server-side; a user without a department grant cannot obtain another department's data through URL or API manipulation (enforcement surface: `resolveDepartmentScope` consumed by workspaces and management endpoints)

**Definition of done — verified:** every management action permission-gated and audited (`department.*`, `user.*`, `role.*`, `staff.availability.*`); no fake controls; phase report delivered here.

**Migrations:** `20261116053120_phase2_operator_availability` (adds `User.isAvailable`, additive only).

**Known limitations of Phase 2 (honest list):** the audit *viewer UI* itself is Phase 6 (events are already persisted and queryable); per-operator ticket workload counts arrive with Phase 4 ticketing; availability feeds the assignment engine in Phase 4; permission changes propagate through a 30-second in-memory cache (invalidated by management actions; worst-case staleness is the TTL window), and multi-node deployments should adopt the PostgreSQL + shared cache path in [DATABASE.md](DATABASE.md) §5. **Repository hygiene note:** `.env` is untracked from this release onward (`.gitignore` covers `.env*`), but a sandbox-era `.env` containing a **development-only** `AUTH_SECRET` remains in earlier Git history — rotate `AUTH_SECRET` (and any credentials) before making the repository public or deploying it, per [SECURITY.md](SECURITY.md).

---

## 4. Phase 3 — Knowledge Base & AI Integration ✅

**Delivered:**

- **Knowledge collections** (`/admin/kb`, permissions `kb.collections.manage` / `kb.departments.assign` / `kb.view`): create/edit/activate, access levels `GLOBAL` / `DEPARTMENT` / `RESTRICTED`, department assignments; guarded delete (only empty collections). Access level + assignments drive retrieval scoping live.
- **Document pipeline** (permissions `kb.documents.upload` / `kb.documents.reprocess` / `kb.documents.delete`): upload PDF/DOCX/TXT/MD (size + content-based MIME allowlist, SHA-256 checksum, storage outside web root & DB via the storage abstraction), explicit extraction (pdf-parse / mammoth / utf-8) → Persian-aware normalization → heading/paragraph-aware chunking → keyword index. Status is a first-class visible state (`Uploaded → Processing → Indexed | Failed | Disabled`) with the real error shown on failures — extraction failures are never silently indexed. Replace (new `KnowledgeDocumentVersion`, history kept), reprocess, disable/enable (drops out of retrieval immediately), delete (chunks/versions/files removed, no orphans).
- **Q&A editor** (permissions `kb.qa.create` / `kb.qa.edit` / `kb.qa.publish` / `kb.departments.assign`): question, official answer, alternate phrasings, category, keywords, department assignments (mandatory), `Draft → Published → Disabled`; only published entries are retrievable and they outrank document chunks (authoritative weighting ×1.15).
- **Retrieval pipeline** (`src/lib/kb/retrieval.ts`): department-scoped keyword search over indexed chunks + published Q&A — hard scope filter resolved **before** any provider call (`GLOBAL` collections + explicitly assigned `DEPARTMENT` collections; `RESTRICTED` never retrievable customer-facing); deterministic scoring (coverage/density/title boost), top-k, per-department minimum-confidence threshold (`Department.aiSettings.minConfidence`, default 0.35). Every retrieval writes a `KnowledgeRetrievalRecord` (query digest, decision, scores, sources) — every answer traceable to stored sources.
- **AI provider layer** (`src/lib/ai/*`): one adapter interface, two drivers — the built-in sandbox provider (z-ai SDK) and any OpenAI-compatible endpoint (Base URL + API key, timeout, temperature/max-tokens); API keys encrypted at rest (AES-256-GCM, `enc.v1` envelopes), masked display only, never returned/logged; global kill switch; test-connection with model listing; provider errors sanitized (`Bearer`/`sk-` redaction).
- **Per-department AI settings** (`ai.department.settings.manage`): AI on/off, minimum confidence, escalation-offer switch, custom fallback message (defaults to the exact standard message), daily AI-message limit (overage → abstain + escalation, never silent).
- **Strictly grounded assistant** (`src/lib/conversations/service.ts`): retrieval precedes generation; answers generated ONLY from retrieved context under a hardened Persian system prompt (no general knowledge, contradiction → abstain, retrieved/customer content is data-not-commands — prompt-injection neutralization verified); abstention emits the EXACT mandated message «برای پاسخ دقیق به این سؤال، اطلاعات تأییدشده‌ای در مخزن دانش سازمان پیدا نشد. می‌توانید درخواست خود را به اپراتور مربوطه ارجاع دهید.» followed by the escalation offer; provider failure persists the customer message, shows the honest unavailable message and offers escalation; bounded retry (1) that never fabricates.
- **Conversation state machine**: `AI_ASSISTED → WAITING_FOR_OPERATOR → ASSIGNED_TO_OPERATOR → HUMAN_ACTIVE → RESOLVED`; the AI never sends automatic replies over a human conversation; customers continue one continuous conversation across transitions; handoff preserves the full transcript; `ai_usage_logs` (tokens, latency, outcome) + audit events throughout.
- **Chat UX**: public landing cards open the live chat dialog (welcome message, typing indicator, source-count badge «بر اساس N منبع تأییدشده» — internal metadata never exposed, escalation button, operator-queue banners, 15 s polling while queued, token-based resume via localStorage); departments without AI start honestly in operator-queue mode; operator inbox in `/support` (scoped list, transcript, reply → self-assign + `HUMAN_ACTIVE`, resolve) with permission-gated actions (`tickets.view` / `tickets.reply` / `tickets.status.change`).
- **Admin dashboards**: `/admin/kb` (three tabs: documents / collections / Q&A) and `/admin/ai` (global settings, test connection, per-department settings, 7-day usage report); dashboard + sidebar chips for KB/AI replaced with real permission-gated modules.

**Mandated test scenarios (spec §14) — verified end-to-end in the browser:**

1. **Exact answer found in the KB** — ✅ training-hours question returned the official Q&A answer with grounded source count.
2. **Relevant information found in an uploaded document** — ✅ membership-renewal question answered from the indexed demo document chunk (information existing only in the document).
3. **No answer found → abstain** — ✅ out-of-KB question produced the exact fallback message + escalation offer.
4. **Contradictory knowledge → abstain** — ✅ after hardening the grounding prompt (initially the model picked one side; fixed with an explicit contradiction rule) the two contradictory Q&A entries produced the exact abstention message. Never a best guess.
5. **AI provider unavailable** — ✅ with an unreachable provider configured: customer message persisted first, honest unavailable message shown, escalation offered; technical error logged server-side without customer PII or secrets.
6. **Cross-department retrieval attempt → blocked** — ✅ a question about membership-department-only knowledge asked through the training department abstained; the retrieval record shows only in-scope sources were candidates (scope resolved before any provider call).
7. **Prompt-injection attempt → neutralized** — ✅ an injected "new management rule" (fake 100% discount) was not adopted; the assistant answered with the real registration policy from the KB.
8. **Customer requests a human operator** — ✅ «ارتباط با اپراتور» → queue mode with preserved transcript → operator reply from `/support` (customer received it via polling, mode `HUMAN_ACTIVE`, one continuous conversation) → resolve → customer sees the resolved state and can start a new conversation.

**Definition of done — verified:** the AI never invented organizational information in any scenario; every answer traceable to stored retrieval records; department scoping resolved server-side before the provider call; design docs updated to as-built state.

**Migrations:** `20261116070919_phase3_kb_ai` (additive: KB models, conversations, retrieval records, AI usage logs, `Department.aiSettings`).

**New packages:** `pdf-parse` (v2 — PDF text extraction), `mammoth` (DOCX extraction); both registered as `serverExternalPackages`. Reused: z-ai-web-dev-sdk (built-in provider driver, backend-only).

**Known limitations of Phase 3 (honest list):**

| Area | Limitation |
|---|---|
| Retrieval semantics | Keyword baseline only (spec §5.3 default); semantic/vector search activates when an embedding model is configured (currently not implemented — the adapter seam exists, `embeddingModel` setting stored) |
| Contradiction detection | Enforced at generation time via the hardened system prompt (verified by scenario 4); no deterministic pre-generation contradiction detector |
| Customer identity | Anonymous token-based conversations (`customerToken`); verified identification, national-ID encryption and customer history arrive in Phase 4 |
| Ticketing linkage | Handoff queues the conversation for the department; ticket records, assignment engine and notifications are Phase 4 |
| AI re-enable during human chat | Not offered yet (spec default: off) — arrives with the Phase-4 operator tooling |
| Rate limiting | Public chat throttling is in-memory per process (10 conversations/h per IP, 20 messages/5 min per conversation) + daily AI-message limits per department; shared multi-node limiting arrives with scale-out |
| Usage reports | Basic 7-day aggregates in `/admin/ai`; full reporting/audit-viewer UI is Phase 6 |
| Assignment of conversations | Operator self-assign on reply; fair-distribution engine is Phase 4 |

---

## 5. Phase 4 — Customer Portal & Ticketing ✅

**Delivered:**

- **Customer identification** (`/portal`, public): ticket creation with national ID + full name — the Iranian national-ID checksum is validated **server-side** (Persian/Arabic digit normalization included); invalid values fail closed with a uniform Persian error and the raw value never appears in any error/log. The national ID is stored **AES-256-GCM encrypted** (`enc.v1` envelope, key material from `APP_ENCRYPTION_KEY`/`AUTH_SECRET` outside the DB) and looked up via a **keyed HMAC-SHA256 index column** — never a primary key, never in URLs, APIs, or operator lists (operators see only the masked tail `•••••••۰۹۵`). One profile spans tickets across departments.
- **Identity verification (OTP) before history access**: 6-digit codes stored only as SHA-256 hashes, 10-minute expiry, max 5 confirm attempts, bounded request rate per IP (5/15 min) and per identity (3/15 min), duplicate-active-code suppression. Dev-only inline delivery (`NODE_ENV !== "production"`, labeled «حالت توسعه» in the UI) — production requires a configured SMS provider seam (`portal.otp` setting, provider `none` = honest 503, never fake delivery). Success issues a **short-lived HMAC-signed httpOnly cookie** (`sd_portal`, 30 min) that gates history endpoints only.
- **Ticketing domain** (`src/lib/tickets/*`): tickets with human-friendly sequential numbers allocated in the creation transaction; status machine `OPEN → IN_PROGRESS ⇄ WAITING_CUSTOMER → RESOLVED → CLOSED` (+ customer-reopen `RESOLVED/CLOSED → OPEN`) enforced server-side for every actor with an append-only `TicketStatusHistory` trail; messaging via `TicketMessage` (CUSTOMER/OPERATOR/SYSTEM) with first-response stamping and self-assign on unattended replies.
- **Attachments**: message-bound, content-based MIME verification (magic bytes; client-declared types never trusted), extension allowlist (pdf/png/jpeg/webp/zip/docx/txt), 10 MB cap, max 5 per message, randomized server-side storage keys under `<STORAGE_DIR>/tickets/` (outside web root & DB, path-traversal-guarded), SHA-256 checksums, downloads **only** through authorized endpoints that re-check ownership (customer) or department scope (staff) per request — unauthorized access returns 401/403/404, verified.
- **Fair-distribution engine** (`src/lib/tickets/assignment.ts`): per-department candidates = ACTIVE staff with availability ON, department membership and effective `tickets.reply` permission; load = active tickets (OPEN/IN_PROGRESS/WAITING_CUSTOMER); per-operator cap from department `ticketSettings.maxActivePerOperator` (default 10, skip-at-cap); winner = least load → oldest last assignment (round-robin fairness) → username (deterministic). Candidate discovery runs outside the write transaction and all assignment-affecting operations (create/auto-assign/transfer) serialize through an in-process lock, keeping SQLite transactions uncontended and the engine **deterministic and concurrency-safe** (mandated test below). Every decision is audited with candidate-load stats.
- **Operator workspace** (`/support`): ticket queue with debounced search (subject/message content/number), status/department/assignee filters, detail sheet with thread (customer right / operator left / system centered; internal notes amber-dashed with a lock chip), permission-gated actions (reply `tickets.reply`, notes `tickets.notes.add`, status `tickets.status.change`, assign `tickets.assign`, transfer `tickets.transfer`, internal creation `tickets.create.internal`, customer history `tickets.customer.history.view`), customer-history dialog (masked ID, past tickets scoped), internal ticket creation dialog (checksum-validated identification), transfer dialog (current department excluded, auto reassignment in target), and an operator **notification bell** in the staff header (assignment, customer reply, status change, transfer, queue-notice; mark-one/mark-all).
- **Customer portal UX**: two tabs — «ثبت تیکت» (identification + department/subject/description/attachments; success shows ticket number + assignee or honest queue notice) and «تاریخچه تیکت‌ها» (OTP → verified list → thread with reply + attachments download + customer notifications, 20 s polling while verified; logout clears the session). Landing page links the portal.
- **AI-to-human handoff linkage (Phase 3 ↔ 4)**: requesting an operator in live chat now creates a tracked ticket (`createdVia=CHAT_HANDOFF`, subject from the customer's first message) driven through the same fair-distribution engine; when an operator is available the conversation moves to `ASSIGNED_TO_OPERATOR` immediately, otherwise it stays honestly queued. Operator replies in the inbox sync the linked ticket (self-assign when unassigned, first-response stamp, `IN_PROGRESS`); resolving the conversation resolves the ticket (`SYSTEM` history entry). Anonymous chats create tickets with a nullable customer reference — no fake profiles.
- **Notifications & audit**: `Notification` model with in-app delivery to operators (bell, 30 s polling) and customers (portal list); every ticket action audited (`ticket.created` with assignment decision stats, `ticket.assign.auto|manual|self`, `ticket.transferred`, `ticket.status.changed`, `ticket.operator.replied`, `ticket.internal_note.added`, `ticket.customer.replied`, `ticket.deleted`, `customer.profile.created`, `identity.verification.*`).

**Mandated concurrency test (spec §14) — `scripts/test-phase4-concurrency.ts`, PASS:**

12 parallel portal ticket creations against a fresh department: **12/12 created**, ticket numbers **strictly unique** (no duplicates), fair distribution **perfectly balanced** (6/6 across the two available operators within the cap), repeated `pickAssignee` **deterministic**, and an audit row with assignment-decision stats for every creation. The test first surfaced a real SQLite contention bug (permission discovery + audit inside the write transaction → pool timeouts), fixed by moving candidate discovery/audit out of the transaction and serializing assignment-affecting operations in-process; `DATABASE_URL` now uses `connection_limit=1` with WAL journal mode (see [DATABASE.md](DATABASE.md) §6).

**Browser-verified end-to-end (agent-browser):** portal creation → fair assignment; OTP request/dev-code/confirm/wrong-code-rejected; verified history + reply; internal note added by operator and **absent from the customer view** (server-filtered); operator reply + status transitions with complete history trail; assignee dropdown with live loads + reassignment; internal creation; customer-history dialog (masked ID, scoped); chat handoff → ticket #7 → inbox reply sync → resolve sync → customer sees «پایانیافته» + «گفتگوی جدید»; customer reply on `WAITING_CUSTOMER` → `IN_PROGRESS` with history entry; operator resolve → customer reply **reopens** (`RESOLVED → OPEN`, `resolvedAt` cleared); department transfer with automatic reassignment; attachment upload → staff download byte-identical, unauthorized downloads 401; operator notifications (assigned/customer reply/status change) + mark-read; mobile 390 px layout.

**Post-delivery hardening (re-verification after a sandbox reset):** full re-run of the portal/ticketing golden paths on a restored environment surfaced one metadata leak — the customer ticket list counted internal notes in `messageCount` (badge showed 4 messages while the thread rendered 3, revealing that a hidden note exists). Fixed by counting only non-internal messages (`_count` with `where: { isInternalNote: false }`); note *content* was already hard-filtered server-side and remains so.

**Definition of done — verified:** customers never see internal notes or private data (hard server-side filters + ownership checks); conversation modes remain a server-enforced state machine; fair distribution is deterministic, concurrency-safe and audited; phase report delivered.

**Migrations:** `20261116093322_phase4_tickets_portal` (additive: customer profiles, identity verification, tickets, messages, attachments, status history, notifications, `Department.ticketSettings`, `Conversation.customerId`) and `20261116094650_phase4_ticket_nullable_customer` (ticket `customerId` → nullable for anonymous chat-handoff tickets, `SetNull` on profile deletion).

**New packages:** `server-only` (import guard for server-only modules, also required by `bun` scripts exercising service code). New dev script: `scripts/test-phase4-concurrency.ts` (run: `bun --conditions=react-server scripts/test-phase4-concurrency.ts`).

**Known limitations of Phase 4 (honest list):**

| Area | Limitation |
|---|---|
| OTP delivery | Dev-inline only; production requires an SMS gateway — the provider seam (`portal.otp`) returns an honest 503 until configured; no email verification alternative yet |
| Notifications | In-app only (operator bell + portal list); no email/SMS push — the model stores `readAt` and kinds, ready for outbound channels in Phase 7 |
| Rate limiting | Portal/OTP rate limits are in-memory per process (consistent with Phase 3 chat limits); shared multi-node limiting arrives with the PostgreSQL path |
| Assignment scope | Fair distribution considers per-department load only (by design); cross-department load balancing is future work |
| Customer identification in chat | Live chat remains anonymous (token-based); linking a chat to a verified profile is future work — handoff tickets carry a nullable customer reference instead |
| Ticket search | Keyword `contains` over subject/messages/customer name (SQLite case sensitivity applies to Latin only); no full-text index yet |
| Attachments | No antivirus scanning integration yet (Phase 5 upload security ships the ClamAV integration point per spec §10) |

---

## 6. Phase 5 — Shared File Hub ✅

**Delivered:**

- **Department file areas** (`/files`, staff workspace): every folder/file belongs to exactly one department; the department selector only ever offers the caller's resolved scope (membership or the `files.all.manage` global key) and **every** API call re-resolves scope server-side. Cross-department read/download/replace/delete/move are impossible by construction (mandated tests below).
- **Nested folder management**: `SharedFolder` self-relation per department with breadcrumb navigation; create/rename/move/delete — moving across departments is intentionally blocked, cycles are guarded (walk-up check), duplicate sibling names rejected, and subtree deletion removes nested folders, their files and their blobs, then frees quota accounting.
- **Upload & download with the full spec §10 posture**: batch (multi-file, ≤10) **all-or-nothing** upload — per-file size cap, extension allowlist (settings-level, can only restrict), **content-based MIME verification (magic bytes; client-declared type never trusted — exe-bytes-named-.pdf fails closed, honestly-renamed zip still uploads)**, duplicate-name rejection, cumulative quota check across the whole batch, then storage under `<STORAGE_DIR>/shared/` with randomized server-side keys outside web root & DB; on any failure nothing is stored and quota accounting stays truthful (rollback deletes already-stored blobs). Downloads only through `GET /api/staff/files/[id]/download` which re-checks `files.download` + department scope per request, streams with `Content-Disposition` (RFC 5987 Persian filenames), `no-store`, `nosniff`; `/storage/…` is never publicly served (verified 404).
- **Quotas (global/department/operator)**: `storage.global` settings — total capacity (2 GB default), default department quota (512 MB), default operator quota (128 MB), per-file max upload (25 MB), extension allowlist; per-department overrides (`Department.storageQuotaBytes`/`operatorQuotaBytes`) and per-user overrides (`User.storageQuotaBytes`) with fallback chain. The chain `maxUpload ≤ operatorQuota ≤ departmentQuota ≤ capacity` is validated on save (fail-closed on nonsense config); lowering values is allowed. Quota checks run per batch (cumulative) *before* anything is stored, with honest Persian errors naming which quota was hit.
- **Storage management UI**: usage report (total / per-department / per-operator with live progress bars, `files.quotas.manage`), settings dialog (`admin.storage.manage`) for capacities, allowlist checkboxes and the antivirus integration point; the workspace card shows the caller's own department/operator/total usage bars at all times.
- **Antivirus integration point (ClamAV) with mandatory-scan semantics**: `storage.av` settings (`provider: none | clamav`, host/port/timeout, clamd INSTREAM protocol over TCP). `provider=none` → files stored with scan status `SKIPPED` and an honest amber chip («اسکن آنتی‌ویروس فعال نیست») — nothing pretends to be scanned. `provider=clamav` → every upload/replace is scanned: CLEAN proceeds, INFECTED rejects the bytes (never stored) and audits `file.scan.infected` with the signature, and an unreachable/erroring daemon **fails closed** — the upload is rejected and `file.scan.error` audited; the UI states the mandatory semantics explicitly.
- **Audit history**: every upload (`file.uploaded`), download (`file.downloaded`), replace (`file.replaced` with version + old/new sizes), rename/move (`file.renamed`/`file.moved`/`folder.*`), delete (`file.deleted`/`folder.deleted` with file counts), scan events and settings changes (`storage.settings.updated`) produce `AuditLog` rows.
- **Storage abstraction (ARCHITECTURE §6 seam honored)**: `StorageDriver` interface (`put/get/delete/stat`) implemented by the local driver behind the canonical `resolveInsideStorageRoot` path-traversal guard; feature modules only see the interface — an S3-compatible driver can replace the local one without caller changes. The ticket-attachment and KB stores remain on their Phase-3/4 helpers (documented in limitations).

**Mandated security tests (spec §14) — `scripts/test-phase5-security.ts`, PASS (38/38):**

Cross-department listing/download/replace/delete/rename/move and folder delete/move all fail closed with `FilesScopeError`; unauthenticated direct-URL access to listing/download returns 401 and `/storage/…` direct access is not served (404) while stored bytes live outside the web root; path-traversal keys (`../`) are rejected by the storage guard; content verification rejects exe-bytes-as-.pdf and unlisted extensions while accepting honest text; duplicate names rejected; per-file max upload, operator quota (cumulative batch), department quota and total capacity each enforced with distinct honest errors; configured-but-unreachable clamd fails the upload closed (never stored unscanned); authorized upload → byte-identical download, replace bumps version and removes the old blob, delete removes the blob and frees quota; folder subtree delete removes nested blobs; audit rows exist for upload/download/replace/delete/folder/scan events. The suite creates throwaway departments/operators (department-scoped via per-user ALLOW overrides, deliberately exercising the override path) and removes everything afterward with BUSY-retry cleanup.

**Browser-verified end-to-end (agent-browser):** admin — folder creation, upload with honest «بدون اسکن» chip, download (disk checksum = DB checksum), rename, move into folder with breadcrumb, version bump via replace, usage report (per-department/per-operator live bars), settings save round-trip (PUT 200), delete with empty-folder state; operator1 (department-scoped, OPERATOR baseline + overrides absent) — nav hides admin links, usage/settings/folder-create controls hidden, folder actions menu hidden entirely (no manage permissions), upload/download works with correct uploader attribution and operator-quota accounting; mobile 390 px layout clean (RTL, no overflow).

**Definition of done — verified:** the storage abstraction backs the full hub (local driver; S3-compatible path preserved); every upload/download/replace/delete is audited; phase report delivered.

**Migration:** `20261116130000_phase5_file_hub` (additive: `SharedFolder`, `SharedFile`, `User.storageQuotaBytes`, `Department.storageQuotaBytes`/`operatorQuotaBytes`).

**Known limitations of Phase 5 (honest list):**

| Area | Limitation |
|---|---|
| AV scanning | ClamAV integration implemented (INSTREAM over TCP) but no clamd daemon ships with the app; production must provision one, otherwise the honest `SKIPPED` state applies — there is no automatic ClamAV install |
| File versioning | Replace bumps a version counter and removes the previous blob (quota-truthful); full multi-version history/restore is future work (KB documents already keep versions) |
| Consolidation | Ticket attachments (Phase 4) and KB documents (Phase 3) still use their dedicated stores; migrating them onto the shared `StorageDriver` is follow-up work |
| Search | No filename full-text search beyond the folder listing; SQLite case-sensitivity applies to Latin names |
| Quota timing | Quotas are in-process aggregated per request (SUM queries) — accurate for SQLite single-node; multi-node deployments move to PostgreSQL with the Phase-7 runbook |
| Env resilience | The dev sandbox periodically resets `.env`; secrets now live in `.env.local` (gitignored) which the sandbox does not touch — production deployments set real env vars per DEPLOYMENT.md |

---

## 7. Phase 6 — Super Admin & Reporting ✅

Complete (master spec §14): system-wide settings; department configuration; granular permissions; storage administration; Knowledge Base administration; AI settings; operator activity; ticket reports; assignment reports; AI usage reports; audit log viewer; system health and operational information.

**Delivered:**

- **Management reports workspace** (`/admin/reports`, `admin.reports.view` + tab-level `ai.usage.view`): four live tabs, every number computed from real rows at request time (no sampling, no placeholders):
  - *Tickets*: totals (created / resolved-in-window / resolution rate), first-response and resolution durations (mean **and** median), backlog by active status, breakdowns by status / created-via / department, and **zero-filled daily created/resolved series** bucketed on the Asia/Tehran calendar day (Iran has no DST since 2022, so fixed ±24 h stepping is exact); Jalali axis rendering on the client.
  - *Operator activity*: per-staff workload report — assigned / resolved / public replies / internal notes within the window, current open load, availability and last-reply time — activity-sorted; the fair-distribution engine's inputs made visible.
  - *Assignments*: distribution-mode split (`AUTO_FAIR` / `MANUAL` / `TRANSFER` / `SELF`), share of automatic fair distribution, assignment-delay statistics (mean/median) and per-operator mode attribution — the fairness of the Phase 4 engine, now measurable.
  - *AI usage*: requests, token totals (prompt/completion), latency, escalation (handoff) rate and the Phase 6 daily series (`byDay`) added to the existing usage endpoint.
  - **Ticket CSV export** (`tickets.export`, `GET /api/admin/reports/tickets/export.csv`): UTF-8 **BOM** so Excel renders Persian correctly, formula-injection-safe field escaping (`=+-@` neutralized), Persian localized column headers, 5 000-row cap, and every export audited as `ticket.exported` with the window + row count in the metadata.
  - Window selector (1–90 days, validated both client and server) + department scope + refresh.
- **Audit log viewer** (`/admin/audit`, `admin.audit.view`): read-only, append-only view over `AuditLog` — conjunctive filters (action substring, actor type, actor label, date range), server-side pagination, and a detail dialog showing actor (joined from `User`), entity, IP + user-agent and pretty-printed metadata JSON. No delete or edit path exists anywhere (API is GET-only).
- **System-wide settings** (`/admin/settings`, `admin.settings.manage`): organization name / tagline / support-intro persisted in `SystemSetting` (keys `org.name`, `org.tagline`, `org.support.intro`) and consumed **live** by the public landing, portal, login page and the chat assistant's system prompt — no restart required. PUT diffs against stored values, persists only changed keys, returns `changedKeys`, and audits `settings.org.updated` (a no-op save writes nothing).
- **Storage administration** (`/admin/storage`, `admin.storage.manage` or `files.quotas.manage`): the Phase 5 usage report (total / per-department / per-operator with quota bars) and the capacities/allowlist/ClamAV controls consolidated into one admin page — the shared storage-views components were extracted from the file-hub workspace so both surfaces render identical, real controls; the usage API guard now accepts either permission key.
- **System health & operational information** (`/admin/health`, `admin.dashboard.view`): measured live at render — database ping latency, process uptime + PID + version, RSS/heap memory, storage usage, live table inventory (tickets by status, active conversations, KB documents, shared files, users, departments, active sessions, audit rows) and the effective runtime security configuration (session TTL, login attempt cap, lockout window, secure-cookie flag, bootstrap flag, env validation verdict). `/api/admin/system-status` gained additive runtime/env/extended-count fields for the same page. Manual refresh via `router.refresh()`.
- **Permission-aware landing**: after login, staff land on the first workspace they can actually open (`admin.dashboard.view` → `/admin`, then `tickets.view` → `/support`, then `files.access` → `/files`) — admins open their control panel, operators never hit a denied dashboard.
- **Already shipped in earlier phases, still in scope for §9**: department configuration (Phase 2 manager + Phase 5 quota overrides), granular permissions (Phase 2 custom roles + per-user ALLOW/DENY overrides), Knowledge Base administration (Phase 3 `/admin/kb`) and AI settings (Phase 3 `/admin/ai`) — no duplicate UIs were built; the dashboard module grid and sidebar link every one of them with real permission gates.
- **Admin dashboard honest-chip retirement**: the Phase 1 «به‌زودی» placeholder chips are gone — the dashboard now renders a permission-filtered grid of twelve working modules plus live entity counts (users, departments, open tickets, audit rows), and the sidebar phase banner honestly lists what is active.

**Mandated permission-matrix & audit tests — `scripts/test-phase6-security.ts`, PASS (26/26):**

Unauthenticated access to every new admin API returns 401; a department-scoped operator with baseline permissions is denied on audit viewer, all report APIs, settings GET/PUT, CSV export and storage usage with the uniform 403 envelope; admin reads the audit page (rows/total/paging), the `action` filter actually filters (nonexistent action → 0 rows) and the actor join resolves usernames; ticket report returns the documented shape with exactly 7 zero-filled buckets and rejects `days=0/91/abc` (422) and unknown departments (422); operator-activity and assignment reports return the documented shapes including all four assignment modes; CSV export is permission-gated (operator → 403), streams `text/csv` with a byte-level BOM and Persian header row, and each export lands in the audit trail (`ticket.exported` with window + row-count metadata); settings PUT with an unchanged payload reports `changedKeys: []` and writes no audit row, a real change persists + reports + audits and is restored afterwards, and invalid input returns 422; AI usage exposes the 7-bucket `byDay` series and system status exposes runtime + operational counts; page-level guards redirect unauthenticated visitors to login and render the honest access-denied panel for the operator while the admin sees the real viewer; audit rows produced by the run carry resolved actor names. The suite creates throwaway users/departments and removes everything afterward.

**Browser-verified end-to-end (agent-browser):** admin — dashboard renders the module grid + live counts; `/admin/reports` all four tabs with real data (7 tickets/57 % resolution/1 h 31 m median first response/4-1-1-1 assignment-mode split/6 AI requests with token series), Jalali chart axes, CSV link fetching `200 text/csv`; `/admin/audit` filters 106 events → 11 for `settings.`, detail dialog shows actor/IP/UA/metadata JSON; `/admin/storage` usage bars + quota/extension/AV controls; `/admin/settings` edit → save → metadata updates («توسط @admin») → restore round-trip with disabled save when clean; `/admin/health` live metrics + refresh; operator1 — lands on `/support` (not the admin dashboard), honest «دسترسی ندارید» panels on `/admin/audit` and `/admin/reports`, staff nav contains no admin links, support desk fully intact (Phase 4 regression check); notifications polling and all prior phases unaffected; `bun run lint` + `bunx tsc --noEmit` clean.

**Definition of done — verified:** every spec §9 capability exists as a real, permission-gated, audited UI (no decorative dashboards — spec §11); the Phase 1 `/admin` honest chips are all replaced by working modules; phase report delivered.

**Migrations:** none — Phase 6 is read/reporting-heavy and reuses existing tables (`AuditLog`, `SystemSetting`, ticket/conversation/file tables); the one new capability key (`admin.reports.view`) joins the in-code catalog and was granted to `SUPER_ADMIN` via the Phase 2 role manager.

**New dev script:** `scripts/test-phase6-security.ts` (run: `bun scripts/test-phase6-security.ts`).

**Known limitations of Phase 6 (honest list):**

| Area | Limitation |
|---|---|
| Report windows | Daily series are day-bucketed only (no hour/week buckets yet); windows are rolling `now − N days`, not calendar-selectable ranges |
| CSV scope | Only tickets export as CSV; operator/assignment/AI reports are UI + API only (copy/paste or future export endpoints) |
| Report indexing | Aggregations run as live SQL `groupBy`/`findMany` scans — correct on SQLite single-node data volumes, but materialized/rollup tables (or PostgreSQL with proper indexes) are the scale-out path in Phase 7 |
| Audit retention | The viewer is read-only and events are never deleted in-app; disk-level retention/archival policy is an operations concern (see BACKUP-RESTORE.md) |
| Audit export | Audit rows are viewable and filterable but not exportable from the UI yet |
| Health scope | Health reflects the single Next.js process + SQLite; multi-node deployments need external monitoring (deployment docs cover the single-node case only) |
| Settings surface | System-wide settings cover organization identity (name/tagline/support intro); further global knobs (locale, ticket SLA defaults) remain per-department or future work |

---

## 8. Phase 7 — Production Hardening ✅

Perform (master spec §14):

- [x] Security review
- [x] Permission matrix testing
- [x] Upload security testing
- [x] AI security and prompt-injection testing
- [x] Knowledge retrieval accuracy testing
- [x] Backup and restore testing
- [x] Upgrade testing (including the SQLite→PostgreSQL runbook if adopted — [DATABASE.md](DATABASE.md) §5)
- [x] Performance testing
- [x] Mobile and RTL review
- [x] Error handling review
- [x] Deployment documentation final pass

**Definition of done — verified:** all mandated tests pass (consolidated suite 69/69 + full re-run of every earlier phase suite); accepted risks are documented in SECURITY.md §9 and the per-phase limitation tables; the vulnerability contact procedure is published as a launch-blocking field (SECURITY.md §7 — the operating organization fills the concrete mailbox/channel at deployment time, which is the only deployable form of "published" for a self-hosted product); final phase report with exact run/deploy commands delivered (§16 report below and DEPLOYMENT.md).

### 8.1 Consolidated hardening suite — `scripts/test-phase7-hardening.ts`, PASS (69/69)

One dev-server run re-proves the whole security posture end-to-end: HTTP security headers (X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, CSP with `frame-ancestors 'none'`, API `no-store`, no `X-Powered-By`); session-cookie flags (HttpOnly, SameSite=Lax, Secure auto-detect); 14 staff/admin pages redirect anonymous visitors to `/login` and 12 staff/admin APIs return the uniform 401 envelope; cross-origin mutations (login, settings PUT, conversation create) are rejected 403 `ORIGIN_MISMATCH` even when authenticated; a 15-endpoint × 3-role permission matrix (SUPER_ADMIN / OPERATOR / FILE_MANAGER) matches PERMISSIONS.md exactly **and** the Phase-2 override system is exercised (per-user ALLOW grants audit access to an operator; per-user DENY beats the role's `tickets.view`); logout invalidates the session server-side; SQLi payloads hit parameterized queries (no crash/no leak) and XSS strings travel as inert JSON data; the AI guardrails re-verified — grounded answer from the exact published Q&A, prompt-injection "new management rule" not adopted, out-of-KB abstention with the exact mandated message + escalation offer, **cross-department scoping proven deterministically** (a temporary Q&A assigned only to the membership department, asked from the training department → abstention; the temp entry is removed afterwards), AI-off department queues honestly, retrieval records + usage logs persisted; error handling (unknown page/API 404 without secret leakage, invalid JSON 400, validation 422, wrong content-type rejected, no stack traces in any envelope); login throttling (12 rapid attempts → extras carry `Retry-After`); account lockout (5 failures → locked, correct password rejected while locked with `Retry-After`, `auth.login.locked` audited, documented recovery unlocks); health endpoint shape without internal details.

### 8.2 Full regression re-run — all green

Phase 4 concurrency (`bun --conditions=react-server scripts/test-phase4-concurrency.ts`): 12/12 parallel portal tickets created, unique numbers, 6/6 fair split, deterministic pick, complete audit trail — including the honest demonstration of the P2002 race-recovery path for simultaneous first-contact profile creation. Phase 5 upload security: 38/38. Phase 6 permission/audit matrix: 26/26. All executed against a **migration-fresh database** (see 8.4).

### 8.3 Backup & restore test — PASS

Executed per the documented procedure's sandbox equivalent: graceful app stop (verified zero remaining processes; WAL checkpointed cleanly — no `-wal` file remains) → backup of DB + `storage/` + `.env`(mode 600) → app restart → mutation through the real API (admin creates a marker user) → graceful stop → **destructive restore** → restart → verification through both file-level and API level: `/api/health` 200 + database true, marker row gone, entity counts restored (users 3 / departments 4 / published QA 3 / indexed docs 1), and the shared file's SHA-256 checksum byte-identical to the pre-backup value. The exercise surfaced a real operational hazard, now documented: **a non-graceful kill leaves un-checkpointed WAL contents, so copying only `custom.db` is not a valid backup** — BACKUP-RESTORE.md §8 now requires the graceful stop (as the Docker CLI does) or copying `custom.db` + `-wal` + `-shm` together, and restore verification must go through the running app.

### 8.4 Upgrade testing — PASS, with one documented runbook hazard

- **Fresh-install path (the supported production story):** `prisma migrate deploy` on an empty database applies all six migrations cleanly; a second run reports "No pending migrations to apply" (idempotency verified on a real database); bootstrap is idempotent (a re-run with a *different* password does not overwrite the super admin); demo seeding is explicit and dev-only.
- **Runbook hazard found & documented (DATABASE.md §4.2):** a database provisioned via `prisma db push` must **never** be reconciled with `resolve --applied <all>` + `migrate deploy` — the re-applied SQLite table-rebuild migrations recreate tables with their early-era column sets and **silently drop columns added by later migrations** (reproduced: phase 2's `new_User` rebuild dropped phase 5's `User.storageQuotaBytes` with no error). The recovery was a clean migration-fresh database + re-seed, after which every suite re-ran green. Production installs created by `migrate deploy` from scratch are immune by construction.
- **SQLite→PostgreSQL runbook:** reviewed as-built (DATABASE.md §5); execution requires a PostgreSQL host plus the §5.2 export/import step — accepted risk documented, single-node SQLite remains the shipped deployment target.

### 8.5 Performance baseline (dev mode, 5 samples, min/avg/max ms)

`/` 40/122/327 · `/login` 28/52/133 · `/api/health` 5/5/6 · `/admin` 102/182/358 · `/admin/audit` 37/55/96 · `/support` 61/81/116 · `/files` 40/51/69 · reports API 11/12/15 · audit API 8/9/9 · staff tickets API 8/8/9 · notifications API 8/8/9. All APIs comfortably under 20 ms; page timings include dev-mode on-demand compilation (production standalone builds remove that overhead). No pathological N+1 or unbounded scans observed at demo data volumes; the scale-out caveats (live SQL aggregations, materialized rollups) remain documented in the Phase 6 limitations.

### 8.6 Mobile & RTL review — PASS (two real defects found and fixed)

All 12 key pages (`/`, `/login`, `/admin`, `/admin/reports`, `/admin/audit`, `/admin/storage`, `/admin/settings`, `/admin/health`, `/support`, `/files`, `/portal`, `/change-password`) measured at a 390×844 viewport: `dir=rtl lang=fa` everywhere and **scroll width exactly 390 px (zero horizontal overflow)** after fixing the two defects the sweep found — `/admin` permissions-list rows (`truncate` does not reduce a flex container's intrinsic min-content; replaced with `min-w-0 flex-1 line-clamp-1`) and `/files` (the long «بدون اسکن» status badge was `whitespace-nowrap shrink-0`; made wrappable). Desktop 1280 px re-checked unaffected; screenshots verified visually (sidebar drawer, cards, chips, progress bars all render correctly RTL).

### 8.7 Security review & error-handling review

Covered by the consolidated suite (8.1) plus a code-level pass over the auth/session/RBAC/audit/storage/AI seams — findings fixed during the phase are itemized in SECURITY.md §9 (landing precedence, mobile overflow; the dev-mode 404's local `.next/dev` chunk references were confirmed absent of any secret names/values and are a dev-only artifact that production standalone builds do not produce).

### 8.8 Deployment documentation final pass

SECURITY.md updated to final as-built (threat model rows T10–T13 marked mitigated, §4 control table all implemented, §7 vulnerability-contact launch gate with fill-in template, §9 phase results); DEPLOYMENT.md carries the v0.7.0 scope summary and a final honest-limitations list; BACKUP-RESTORE.md gains the WAL/graceful-stop section; DATABASE.md gains the `db push`-reconciliation warning. Exact run/deploy commands: development `bun install && bun run bootstrap && bun run seed-demo && bun run dev`; production `./scripts/supportdesk.sh install` → forced first-login password change → HTTPS via the Caddy overlay; upgrade `./scripts/supportdesk.sh update <X.Y.Z>`; backup/restore per BACKUP-RESTORE.md; test suites `bun --conditions=react-server scripts/test-phase4-concurrency.ts`, `bun --conditions=react-server scripts/test-phase5-security.ts`, `bun scripts/test-phase6-security.ts`, `bun scripts/test-phase7-hardening.ts` (dev server required on :3000; the Phase 7 suite sleeps ~2 min between throttle scenarios and refuses to run in production).

**Migrations:** none (hardening phase); VERSION 0.7.0.

**New dev script:** `scripts/test-phase7-hardening.ts` (run: `bun scripts/test-phase7-hardening.ts`).

**Known limitations of Phase 7 (honest list):**

| Area | Limitation |
|---|---|
| Performance testing | Baseline measurements at demo data volumes in dev mode; no load-testing tooling (k6/autocannon) was mandated or run — the aggregation/indexing caveats from Phase 6 remain the scale-out checklist |
| PostgreSQL runbook | Reviewed as documentation only (no PostgreSQL host in this environment); the §5.2 export/import step remains a manual, per-deployment procedure |
| Security contact | The concrete mailbox/channel is a deployment-time obligation (SECURITY.md §7 template) — a self-hosted product cannot publish a real contact on the organization's behalf |
| Load testing | Rate limits are in-memory per process; multi-node shared limiting is only meaningful with the PostgreSQL scale-out and remains future work |

---

## 9. Known limitations of Phase 1 (honest list)

The following are **not implemented** in this delivery and are marked as upcoming in the UI — no fake buttons (spec §11/§15):

| Area | Limitation |
|---|---|
| Public conversations | The landing page renders real department cards from the DB, but department clicks do not open conversations yet — cards carry the honest «به‌زودی» badge; conversation UI arrives in Phase 4 |
| AI assistant | Not implemented (design: [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md)) |
| Knowledge Base | Not implemented (design: [KNOWLEDGE-BASE.md](KNOWLEDGE-BASE.md)) |
| File hub | Not implemented — only the storage abstraction stub exists (Phase 5) |
| OTP identity verification | Not implemented (Phase 4; modeling rules pre-agreed) |
| Notifications | Not implemented (Phase 4) |
| Admin management modules | Department/user/role management UIs are live (Phase 2); storage/AI/KB/audit-viewer UIs remain Phase 3/5/6 with honest chips |
| Role binding | Staff users have one role (`User.roleKey`); multiple roles per user remains future work (custom roles + overrides shipped in Phase 2) |
| Database | SQLite v1 by design (single-node, one-file backup); PostgreSQL switch runbook documented ([DATABASE.md](DATABASE.md) §5) |
| Rate limiting | Login throttling is in-memory (per process) + DB-backed account lockout; multi-node shared limiting arrives with scale-out (see [ARCHITECTURE.md](ARCHITECTURE.md) D4) |
| Super admin recovery | No committed reset CLI — recovery is the documented one-off script procedure ([SECURITY.md](SECURITY.md) §6.3) |
| Demo data | `bun run seed-demo` inserts demo departments for development/demo environments only — never mixed with production data (spec §15) |
