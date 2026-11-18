# 01 — Current Repository Audit

All findings are from direct source inspection [V] unless marked otherwise. Paths are relative to `/home/z/my-project`.

## 1. Method

- Four parallel deep-inspection passes over: (a) architecture & full API surface, (b) authentication/authorization/security, (c) data layer/ops/dependencies, (d) AI-RAG-KB subsystem & test assets.
- Load-bearing claims (VERSION, package.json, ci.yml, git log) re-verified first-hand by the audit lead.
- Grep sweeps for stub/mock/placeholder markers, unsafe patterns (`eval`, `child_process`, `$queryRawUnsafe`, unguarded `JSON.parse`, `Math.random` on credentials).

## 2. What this codebase actually is

A single-process modular monolith [V — `ARCHITECTURE.md` §1, `scripts/docker-entrypoint.sh`]: one Next.js 16 (App Router) process, one SQLite file (WAL mode), one local storage directory. Route handlers are thin (parse → validate → delegate); all business rules live in `src/lib` (86 modules, ~16,900 lines):

| Area | Key modules | State |
|---|---|---|
| Auth & sessions | `src/lib/auth/{session,password,service,throttle}.ts` | Complete; DB-backed, revocable |
| RBAC & scoping | `src/lib/rbac/{service,scope}.ts`, `PERMISSIONS.md` | 52 keys, DENY-wins, dept scope |
| Tickets | `src/lib/tickets/{service,attachments,assignment,...}.ts` (~2,240 ln) | Lifecycle + fair-distribution + notifications |
| Conversations (live chat) | `src/lib/conversations/{service,rate-limit}.ts` | State machine AI_ASSISTED→HUMAN_ACTIVE→RESOLVED |
| Citizen identity (کد ملی) | `src/lib/customers/{identity,session,accounts}.ts` | AES-256-GCM national ID + HMAC index + signed portal cookie |
| Tickets/portal API | `src/app/api/public/portal/**` (9 routes) + `staff/**` (17) | Ownership in query, notes filtered |
| File hub | `src/lib/files/**` (~1,475 ln) | Quotas, folders, replace/versioning, ClamAV fail-closed |
| KB + RAG engine | `src/lib/kb/**` + `src/lib/rag/**` (~5,284 ln) | Full 7-stage engine (see §7) |
| Admin | `src/lib/admin/**`, `src/lib/reports/**` | Users/roles/departments/settings/audit viewer/reports+CSV |
| Platform | `src/lib/{api,env,crypto,storage,audit,settings,bootstrap,version}.ts` | Uniform envelope, zod env, AES-GCM secrets, KV settings |

**Version fact:** `VERSION` = **0.9.0**; `package.json` = **0.4.0**; several docs say "v0.7.0 final". Runtime resolves VERSION file first (`src/lib/version.ts:9`). Three-way drift [V].

**Git history [V]:** commits `faee06c`→`2a2315c` show RAG Stages 1–7b and Phase 8 (citizen password accounts replacing OTP) all landed. The previously "planned" ticket-user (کد ملی) feature is **already implemented**.

## 3. Architecture & module boundaries

- Clean layering: thin route handlers (82 route files) → `src/lib` services → Prisma. Server pages gate through `StaffShell` server component (`src/components/shell/staff-shell.tsx:22-38`).
- `src/proxy.ts` (Next 16 middleware equivalent) only does cookie-presence redirect for `/admin*`; real authz is server-side [V].
- 25% of files are client components; no state library is actually used (plain hooks + `apiFetch` envelope helper) — `zustand` and `@tanstack/react-query` are declared but never imported [V].
- Boundaries are respected: no route reaches into Prisma directly for business decisions (verified by reading route/service pairs); no `eval`/`child_process` anywhere in `src/`.

**Assessment [R]:** boundaries are genuinely good. The monolith is appropriate for the deployment profile (single-node Docker) and keeps the option of extracting the RAG worker into a separate process later (queue is DB-backed and restart-safe).

## 4. API surface (82 route files)

- Every mutating handler calls `assertSameOrigin` (`src/lib/api.ts:68-155`) — verified across all 77 route files that export mutations [V]. No CSRF-token mechanism; defense = origin check + `SameSite=Lax` + httpOnly cookies. Missing `Origin` header is allowed (non-browser clients) — documented rationale in `SECURITY.md` §5.
- Uniform `{ok,data}/{ok,error,code}` envelope with Persian messages; zod on every JSON body via `parseBody`. ~17 thin handlers omit try/catch (unexpected throws bypass the envelope → default 500) [V].
- Multipart endpoints validate caps pre-parse (portal: `src/app/api/public/portal/_form.ts`); staff ticket multipart relies on service-level validation — parity gap, low.

## 5. Authentication & session management

- Custom DB-backed sessions (NextAuth v4 is a declared dependency but **zero imports exist** [V]): 32-byte CSPRNG token, only SHA-256 stored (`src/lib/auth/session.ts:41-69`), revocable server-side, TTL 1–720 h (default 168).
- bcrypt cost 12 + timing-equalized dummy compare on unknown user (`src/lib/auth/password.ts`).
- Brute force: per-IP sliding window 10/min (in-memory) + DB-persisted per-account lockout 5 fails/15 min (`src/lib/auth/service.ts:26-106`).
- Citizen portal: separate identity plane — national ID stored encrypted (`enc.v1` AES-256-GCM) + keyed HMAC equality index, never plaintext-keyed (`prisma/schema.prisma:585`, `src/lib/customers/identity.ts`); login throttled per-IP **and** per-ID-HMAC; session = HMAC-signed stateless cookie, 30-min TTL, non-revocable [V].
- Password rotation on change: staff sessions revoked (keep current) [V]; citizen cookie not invalidated (low) [V].

## 6. Authorization

- Deny-by-default: effective permissions = role bindings ∪ user overrides, DENY wins, 30 s cache with invalidation (`src/lib/rbac/service.ts:41-72`).
- Department scoping enforced at SQL/query level in every reviewed `[id]` service (tickets, attachments, conversations, files, citizen threads). One partial leak: `GET /api/staff/customers/[id]` returns profile identity (name + masked national ID) outside department scope (ticket list is scoped) — low [V].
- `mustChangePassword` is enforced in page shells and login redirect but **not** in `requireAuth`/`requirePermission` [V — medium].

## 7. Data layer

- `prisma/schema.prisma`: 33 models, SQLite provider, 7 real migrations under `prisma/migrations/` [V]. Entrypoint runs `prisma migrate deploy` (`scripts/docker-entrypoint.sh:47-53`).
- Convention: strings-for-enums and JSON-as-String (documented, schema header L4-12) — a SQLite portability choice; `DATABASE.md` ships a SQLite→PostgreSQL portability runbook [V].
- Denormalization is deliberate and bounded (active-version snapshot on `KnowledgeDocument`, actor label snapshots, lockout counters). Minor FK index gaps: `Notification.departmentId/.ticketId/.conversationId`, `AiUsageLog.conversationId` [V].
- **Footgun:** `db:push --accept-data-loss` exists as `npm run db:push` alongside the migration policy [V].

## 8. Background work, caching, realtime

- Only background worker: RAG job queue — DB-backed (`RagJob`), race-safe claim, backoff 10/30/120 s, max 3 attempts, 5 s poller started from `src/instrumentation.ts:36`. Restart-safe by design [V].
- All AI turns, AV scans, and document extraction run **inline in HTTP requests** with explicit budgets (25 s deadline, ≤6 LLM calls/turn) [V].
- Caches (settings/RBAC/RAG config) and rate-limit buckets are **per-process in-memory** with TTLs and documented single-node limitation (`DEPLOYMENT.md:221-222`).
- Realtime = client polling every 15–30 s (chat 15 s, inbox 20 s, queues 30 s) [V]. No SSE/WebSocket. Acceptable for v1; a scale-out gap.

## 9. File storage & uploads

- Storage root `STORAGE_DIR` outside web root; single path-traversal guard enforced on every byte op (`src/lib/storage.ts:38-45`) [V].
- Ticket attachments: 10 MB + 5/message, extension allowlist + **magic-byte verification** (fail-closed), SHA-256 checksum, randomized server-generated keys [V].
- File hub: MIME re-typing by content, quota chain (total/dept/operator), batch cap 10, **real ClamAV clamd INSTREAM client, fails closed on scan errors** (`src/lib/files/scan.ts`) [V].
- KB uploads: MIME allowlist + 15 MB cap but **no magic-byte sniffing** [V — low].
- Downloads: authorized routes only, `Content-Disposition: attachment`, `nosniff`, `Cache-Control: private, no-store` [V].

## 10. Audit logging

- 80+ audited action types covering auth, admin mutations, ticket lifecycle, citizen flows, file ops, KB/RAG ops [V — grep-exhaustive list available].
- Gaps: authorization denials (403s) not audited (SECURITY.md claims otherwise); staff/portal attachment downloads not audited (file-hub downloads are); failed citizen password-change not audited; audit writer is best-effort (swallows errors) [V].

## 11. AI/RAG subsystem (as built — not a plan)

- Full engine in `src/lib/rag/**`: structure-aware ingestion (PDF per-page, DOCX headings/tables, XLSX sheets), SECTION-parent/PARAGRAPH-child chunking with `headingPath`+page provenance, Persian normalization (NFKC, Arabic→Persian, diacritics/ZWNJ strip), lexical scorer + JSON-vector cosine index behind a `VectorIndex` interface (explicit pgvector swap point) + RRF fusion, parent expansion, heuristic/LLM rerankers, CRAG controller with bounded corrective loop and validity filters, grounded generation with hard citation markers + forged-marker stripping + optional LLM claim screen, `RagTrace`/`KnowledgeRetrievalRecord` persistence, admin panel, eval harness (`acceptance-v1`, 8 cases, recall@5 = 1.0 baseline) [V].
- Strict policy implemented as specified: evidence-only answers, mandated abstention strings, validUntil supersession filter, department scoping enforced **inside the retrieval SQL**, prompt-injection hardening in all prompts, FAST_QA deterministic short-circuit for published Q&A.
- Honest limitation [V — code header]: default embedding provider is `hashed-fa-v1` (char-ngram hashing fallback, not semantic). Production path = configure an OpenAI-compatible `/embeddings` endpoint (already supported; model/dim mismatch safety works).
- Dead code: `src/lib/kb/{extract,chunking,retrieval}.ts` have zero importers [V] — legacy leftovers to delete.
- `ESCALATE` status defined but never produced (escalation only via explicit handoff endpoint) [V].
- Qragy was already evaluated in-repo: AGPL-3.0 ⇒ decision "zero source reuse, original implementation" (`docs/RAG-ENGINE.md` Stage 1, commit `faee06c`) [V]. This audit independently re-verified qragy's AGPL-3.0 LICENSE and 4-star scale [V].

## 12. Tests & QA

- 4 scripted suites: phase4 concurrency (12 scenarios), phase5 security (39 checks), phase6 security (28 checks), phase7 hardening (59 checks; ROADMAP records 69/69 with re-runs). Plus RAG eval (8/8). They mix in-process service calls (phase4/5) and real HTTP against a running server (phase6/7); DB mutations with unique-suffix cleanup; self-refuse in production [V].
- **No unit test framework, no UI/E2E tests, no tests in CI** (CI = lint/typecheck/build only) [V]. Phase 4 cleanup deletes all notification rows; phase 7 leaves chat rows; slow throttle sleeps [V].
- Coverage gaps: KB upload over HTTP, provider-switch flows, concurrent-HTTP, migration upgrades, load tests, multi-replica behaviors [V].

## 13. Deployment, ops, backup

- Multi-stage Dockerfile (node:22-slim, non-root, tini, HEALTHCHECK→`/api/health`), docker-compose with named volumes, Caddy TLS overlay, `.github/workflows/release.yml` (ghcr, semver tags only, never `:latest`), `scripts/supportdesk.sh` (764-line ops CLI: install/update/backup/restore/status/logs), `BACKUP-RESTORE.md` (WAL honesty, cron example, retention, offsite guidance) [V].
- `.github/workflows/ci.yml` is **valid YAML with correct `branches: [main]` triggers** [V — first-hand read; an initial automated pass misread this file and reported corruption; the claim was re-verified and is false].
- Absent: scheduled backup job in-repo (documented only), error tracking (Sentry), structured logging (console-only, 105 call sites), dependabot/renovate, orphan-file sweeper/retention job [V].

## 14. Dependencies

- Runtime: next ^16.1.1, react ^19, prisma ^6.11.1, zod ^4.0.2, bcryptjs ^3.0.3, mammoth, pdf-parse v2, xlsx ^0.18.5, z-ai-web-dev-sdk ^0.0.18 (single dynamic import: `src/lib/ai/adapter.ts:126`).
- Flagged [V + knowledge]: `xlsx@0.18.5` (prototype-pollution/ReDoS CVE class; parses untrusted uploads — upgrade to 0.20+ or replace), `next-auth ^4.24.11` (unused), 8 more declared-but-unused deps (`zustand`, `@tanstack/react-query`, `uuid`, `framer-motion`, `@mdxeditor/editor`, `react-syntax-highlighter`, `sharp`, `next-intl`) — audit-surface noise and image bloat.
- `typescript.ignoreBuildErrors: true` and `reactStrictMode: false` in `next.config.ts` [V].

## 15. Stub/mock/placeholder scan

- `src/`: 68 matches, **all** UI `placeholder=` attributes or informative comments. Zero TODO/FIXME/XXX/HACK/stub/mock/"not implemented" [V].
- `scripts/`: benign matches only (mktemp templates, "hack" strings as attack-payload fixtures in security tests, explicit demo seed). `scripts/restore-demo-operators.ts` is a dev-only maintenance script with a hardcoded demo password — harmless but should not ship [V].

## 16. Maturity scorecard

| Dimension | Grade | Basis |
|---|---|---|
| Architecture & boundaries | **Good** | Thin routes, service layer, seams (`VectorIndex`, `StorageDriver`, `AiProviderAdapter`) |
| DB schema & migrations | **Good** | 33 models, 7 migrations, documented conventions; minor index gaps; `db:push` footgun |
| Authentication | **Good** | DB sessions, bcrypt12, lockout; citizen plane solid; cookie non-revocability low |
| Authorization | **Good** | Deny-by-default RBAC, dept scope per resource; 1 low leak; `mustChangePassword` API gap |
| Business logic & state | **Good** | Ticket state machine + history, conversation state machine, fair distribution (concurrency-tested) |
| Validation & error handling | **Good** | zod everywhere on JSON; ~17 handlers missing envelope |
| Background jobs | **Adequate** | DB queue restart-safe; everything else inline-with-budgets |
| File storage & access control | **Good** | Magic bytes, quotas, AV fail-closed, traversal guard |
| Audit logging | **Good** | 80+ actions; denials/downloads gaps |
| Security-sensitive ops | **Mixed** | `Math.random` passwords, dev-fallback secrets, XFf trust |
| Tests | **Adequate** | 4 scripted suites + eval; no CI tests, no unit/UI frameworks |
| Docker/deploy | **Good** | Full compose/Caddy/CI/release/ops-CLI story |
| Backup & recovery | **Adequate** | Scripted backup/restore; cron must be installed by operator; no PITR |
| Dependency health | **Mixed** | xlsx CVE class; 9 dead deps |
| Realtime & scale-out | **Weak** | Polling only; in-memory limits/caches; SQLite single-writer ceiling |
| **Overall [R]** | **Solid, honest v0.9 prototype with defined hardening list** — a viable foundation, not yet production-hardened |

## 17. Notable contradictions with earlier task documents

- Any plan text saying "Preserve PostgreSQL and Drizzle" contradicts repo reality: the stack is **Prisma + SQLite** with a documented PostgreSQL portability runbook (`DATABASE.md`) [V]. Architecture decisions in this audit follow the actual stack.
- `ARCHITECTURE.md` calls storage a "stub" — stale Phase-1 wording; the driver is complete [V].
- `agent-ctx/4-a-customer-portal.md` references OTP verify routes removed in Phase 8 [V] — stale dev notes.
