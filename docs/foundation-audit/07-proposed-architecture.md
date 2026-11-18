# 07 — Proposed Architecture

Based on the recommended foundation (Doc 06). Current-state facts [V]; target-state items are [R] until implemented.

## 1. Core application (unchanged shape)

```
┌────────────────────────────── single host / docker-compose ──────────────────────────────┐
│                                                                                          │
│  [Caddy TLS] ──► [Next.js 16 monolith :3000]                                             │
│                    ├── pages: / (landing) /login /portal /support /admin /files          │
│                    ├── api: 82 route files (public chat + portal + staff + admin)        │
│                    ├── lib: auth/rbac/tickets/conversations/customers/files/kb/rag/ai    │
│                    └── RAG worker (in-process timer over DB-backed RagJob queue)         │
│                                                                                          │
│  [SQLite (WAL)  ──► Postgres upgrade path]   [STORAGE_DIR volume]   [optional sidecars]  │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Extension/custom modules (ours):** citizen identity, CRAG policy, fair distribution, RBAC catalog, audit, file hub.
- **External services (adopted, optional):** OpenAI-compatible embeddings endpoint; SMTP/IMAP bridge; RAGFlow parsing sidecar (Apache-2.0); Sentry-class collector; Redis (only in scale profile); Chatwoot gateway (gated add-on).
- **Integration boundaries:** all third-party contact happens through `src/lib/ai/adapter.ts` (chat/embeddings), a new `src/lib/mail/` bridge, and — if Gate G1–G3 pass — a new `src/lib/integrations/chatwoot/` module using Chatwoot's public APIs with pinned release versions.

## 2. Ownership matrix (no duplicated systems)

| Concern | Owner | Notes |
|---|---|---|
| Staff authentication & sessions | **Core app** (`src/lib/auth`) | DB-backed, revocable; stays |
| Citizen (کد ملی) identity | **Core app** (`src/lib/customers`) | Single source of truth; any external system receives *projections* (identifier + HMAC), never authority |
| Authorization & departments | **Core app** (`src/lib/rbac`, `src/lib/rbac/scope`) | 52-key catalog, DENY-wins, dept scope |
| Conversation/ticket business logic | **Core app** | State machines verified; Chatwoot add-on, if adopted, mirrors state via API and never becomes authoritative |
| Database | **Core app**: SQLite now; Postgres via runbook (`DATABASE.md`) | One application database; Chatwoot, if adopted, keeps its own DB (isolated concern) |
| File storage | **Core app** `StorageDriver` (local now; S3 seam reserved) | Outside web root, traversal-guarded |
| AI/RAG | **Core app** engine; providers swappable | `VectorIndex`/reranker/provider seams; eval harness gates changes |
| Audit | **Core app** `AuditLog` (+ Chatwoot-side audit kept internal to that system, integrated only as report input, not merged) | Avoids lossy unification |

## 3. Authentication & authorization ownership

- Staff plane: custom DB sessions (bcrypt12, lockout, revocation) — unchanged, minus M0 fixes.
- Citizen plane: national-ID + password; HMAC-signed 30-min portal cookie (stateless by design) with M0 improvement: server-side revocation list keyed on profile (password-change invalidation).
- External-system trust rule [R]: any integrated system (Chatwoot, mail bridge) is treated as untrusted input source; webhooks validated by shared-secret signature + replay window; inbound channel messages pass the same validation pipeline as portal submissions.

## 4. AI/RAG subsystem (target state)

- Engine unchanged; **production embeddings** via configured OpenAI-compatible endpoint; embedding model/dim mismatch safety already enforced at query time [V].
- Scale-out: swap `JsonInMemoryVectorIndex` for pgvector implementation behind `createVectorIndex()` factory [V — seam exists].
- Parsing sidecar (optional): RAGFlow receives files, returns structured text; our chunker/normalizer/indexer remain authoritative; sidecar output treated as untrusted data (injection rules unchanged).
- Evals (`acceptance-v1` 8/8 baseline [V]) extended with adversarial corpus; eval gate required for any engine change.

## 5. Deployment architecture

- **Profile 1 — single node (default):** current compose + Caddy TLS overlay + cron backup from `BACKUP-RESTORE.md` [V]. Target: add automated `backup` scheduling example in-repo (operator-installed today).
- **Profile 2 — scale (triggered):** Postgres (+pgvector) + Redis-backed throttle/cache adapter + optional separate worker process consuming the same `RagJob` table (queue is DB-backed and restart-safe [V]).
- **Profile 3 — multichannel (gated):** + Chatwoot (PG/Redis) behind the same edge; our portal remains the only citizen-facing surface; operators may use Chatwoot console if G3 passes.
- Single external port policy (sandbox relay) is a dev-environment constraint, not a production constraint; production exposes 80/443 via Caddy [V — `deploy/caddy/`].

## 6. Upgrade strategy

- Semantic-release style tags (existing `release.yml` publishes ghcr images, never `:latest` [V]).
- DB changes: versioned Prisma migrations only; `db:push` demoted/removed from scripts [R].
- Before each release: `bun run lint && typecheck && build` in CI + elevated test suites (Doc 10 M1) + RAG eval run.
- Adopted external components pinned to exact versions; upgrades reviewed against their changelogs/security advisories; Chatwoot `enterprise/` stays excluded at image build.

## 7. Backup & restore strategy

- Keep `scripts/supportdesk.sh backup|restore` as the canonical mechanism (stop → crash-consistent copy → tar of DB + storage + `.env` → health check [V]).
- Institutionalize: cron schedule (documented today), 30-day retention, offsite sync (documented rclone guidance), **quarterly restore drill with recorded evidence**, orphan-storage reconciliation job [R — new].
- Postgres profile: `pg_dump` custom format nightly + WAL archiving (PITR becomes possible — a genuine gain over SQLite) [R].

## 8. What this architecture deliberately does not do

- No microservices split, no second AI engine, no second user system, no data unification hacks between audit stores, no premature Postgres/Redis adoption before the load-test trigger, no AGPL code in the core.
