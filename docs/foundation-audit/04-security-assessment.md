# 04 — Security Assessment: Preliminary Threat Model & Verification Strategy

Basis: direct code inspection [V] (file:line references below) plus runtime behavior from the repo's own security suites. This document does **not** claim security merely because established libraries/frameworks are used; it lists what is actually enforced and what remains open.

## 1. Threat model (T-numbers continue the scheme in `SECURITY.md`)

| # | Threat | Current status | Evidence (file:line) | Residual risk |
|---|---|---|---|---|
| T1 | Authentication bypass / credential stuffing | **Mitigated**: bcrypt cost 12 + timing-equalized dummy compare; per-IP 10/min sliding window; DB-persisted lockout 5/15 min; generic errors (no user enumeration) | `src/lib/auth/password.ts:8-55`, `src/lib/auth/service.ts:26-143`, `src/lib/auth/throttle.ts` | Limiter is in-memory + keys on spoofable `x-forwarded-for` (M) |
| T2 | Session theft/fixation | **Mostly mitigated**: 256-bit CSPRNG tokens, only SHA-256 stored, revocable, httpOnly/SameSite=Lax/secure-in-prod; staff sessions revoked on password change | `src/lib/auth/session.ts:32-105,113-141` | No token rotation on use; citizen portal cookie (HMAC, 30 min) non-revocable (L); `Secure` driven by NODE_ENV not `x-forwarded-proto` (doc drift) |
| T3 | Privilege escalation | **Mitigated**: deny-by-default RBAC (52 keys), DENY-wins overrides, last-active-superadmin guard, system roles immutable | `src/lib/rbac/service.ts:41-72`, `src/lib/admin/users.ts:173-207`, `src/lib/admin/roles.ts:104-142` | `mustChangePassword` not enforced in API guards (M); 403s not audited |
| T4 | Cross-department data leakage | **Mitigated**: scope re-checked per resource in every reviewed `[id]` service (tickets, attachments, conversations, files, citizen threads); retrieval scoping inside SQL | `src/lib/tickets/service.ts:708-724,1577-1616`, `src/lib/conversations/service.ts:822-880`, `src/lib/rag/index/scope.ts`, `src/lib/files/service.ts:629-661` | One low: staff customer-profile identity returned unscoped (`src/lib/tickets/service.ts:1489-1502`) |
| T5 | IDOR | **Not found** in reviewed routes; portal ownership enforced in query (`where:{id,customerId}`), internal notes hard-filtered | `src/lib/tickets/service.ts:859-870`, `src/app/api/public/portal/tickets/[id]/route.ts:16-24` | Keep automated IDOR regression suite (see §3) |
| T6 | Injection (SQL/NoSQL) | **Mitigated**: Prisma parameterized queries only; single `$queryRaw` is a constant `SELECT 1`; no `$queryRawUnsafe` | `src/lib/db.ts:18` | — |
| T7 | XSS | **Partial**: React escaping everywhere; no user HTML rendering; `dangerouslySetInnerHTML` only in stock shadcn `ui/chart.tsx:83` with non-user config | `next.config.ts:38` | CSP allows `'unsafe-inline' 'unsafe-eval'` (L) — tighten |
| T8 | CSRF | **Mitigated (pattern: origin-based)**: `assertSameOrigin` on every mutating route (verified across 77 files), multi-reference host set incl. dot-suffix trusted origins, SameSite=Lax, httpOnly cookies | `src/lib/api.ts:68-155` | No CSRF tokens; missing-Origin allowed by design (documented); header-trust residual (L) |
| T9 | SSRF | **Low surface**: only outbound calls are to admin-configured AI/embedding endpoints (permission-gated `ai.provider.configure` + `ai.credentials.update`); no user-controlled URL fetch | `src/lib/ai/adapter.ts`, `src/app/api/admin/ai/test-connection/route.ts` | URL allowlist/scheme check for provider endpoints is advisable (L) |
| T10 | Unsafe file uploads | **Mitigated**: magic-byte verification fail-closed (tickets + file hub), extension allowlists, randomized server keys, path-traversal guard on storage root, quota chain, ClamAV fail-closed, RFC 5987 download disposition + nosniff + no-store | `src/lib/tickets/attachments.ts:16-115`, `src/lib/files/{mime,scan,service}.ts`, `src/lib/storage.ts:38-45` | KB uploads lack magic-byte sniffing (L); `xlsx@0.18.5` parses untrusted workbooks — CVE-2023-30533/CVE-2024-22363 class (L→fix) |
| T11 | Secret exposure | **Mostly mitigated**: zod-validated env, secrets never returned (masked), AES-256-GCM `enc.v1` for AI keys, sanitized provider errors, `.env` gitignored | `src/lib/env.ts`, `src/lib/crypto.ts:22-45`, `src/lib/ai/settings.ts:104-120` | Dev-fallback secrets incl. known superadmin password when NODE_ENV≠production; NODE_ENV defaults to development (M); plaintext temp passwords returned once by design (acceptable, but see T12) |
| T12 | Insecure randomness | **Defect found**: temporary/reset passwords generated with `Math.random()` while crypto `randomBytes` is used elsewhere | `src/lib/admin/users.ts:284-299`, `src/lib/customers/accounts.ts:65-72` | **Med-High — replace with `randomBytes`** |
| T13 | Race conditions | **Mitigated for critical paths**: unique ticket `number` under SQLite single-writer + concurrency suite (12 parallel creates, sequential numbers verified); DB-queue claim via conditional `updateMany` | `scripts/test-phase4-concurrency.ts`, `src/lib/rag/jobs.ts` | Multi-replica invalidates in-memory assumptions (documented single-node) |
| T14 | Data loss / unsafe migrations | **Partial**: versioned migrations + `migrate deploy` at boot; backup/restore CLI + WAL guidance | `prisma/migrations/`, `scripts/docker-entrypoint.sh:47-53`, `BACKUP-RESTORE.md` | `db:push --accept-data-loss` footgun; no PITR (SQLite); no scheduled backup in-repo; no migration rollback test |
| T15 | Backup/restore failure | **Partial**: scripted backup (stop → tar DB+storage+.env) and typed-YES restore; health-check after restore | `scripts/supportdesk.sh backup|restore` | Restore drills must be scheduled and evidenced (see §3) |
| T16 | Prompt injection (document content / user text) | **Mitigated at policy level**: all prompts declare documents as data; instructions inside evidence ignored; strict citation mode; forged citation-marker stripping; optional LLM claim screen; FAST_QA returns verbatim official answers (no generation) | `src/lib/rag/generate/answer.ts:83-97`, `src/lib/rag/generate/verify.ts`, `src/lib/rag/engine.ts` | Extend eval set with adversarial corpus cases (R) |
| T17 | Abuse of public surfaces | **Partial**: rate limits on conversation create (10/h/IP) and messages (20/5min/token), login limits, AI daily quota per department; CAPTCHA absent | `src/lib/conversations/service.ts:510,627,353` | Global per-IP edge limiter at Caddy advisable (R) |
| T18 | National-ID (PII) exposure | **Mitigated**: AES-256-GCM at rest + keyed HMAC lookup index (no plaintext key), masked display, actor labels instead of PII in audit, deterministic encryption key derivation from env secrets | `src/lib/customers/identity.ts`, `prisma/schema.prisma:585` | Key rotation runbook exists (`SECURITY.md` §6); test key-rotation drill |

Severity ledger: 1 Med-High (T12), 5 Med (T1 residual, T3 residual ×2, T11 residual, T14 residual), 6 Low, rest Info — consistent with Doc 00 table.

## 2. What we explicitly do NOT claim

- No claim that the origin-check CSRF pattern equals token-based CSRF; residual risk is accepted and documented (`SECURITY.md` §5).
- No claim that in-memory rate limiting is effective beyond a single process.
- No claim that the hashed-embedding fallback is a semantic model (it is an IRM fallback — honest limitation in `src/lib/rag/embedding/hashed.ts`).
- Security suites passing on the dev sandbox ≠ penetration testing.

## 3. Verification strategy required before production deployment

1. **Fix-then-verify gates (M0):** T12 randomness; NODE_ENV/dev-fallback hardening; `mustChangePassword` in `requireAuth`; SECURITY.md truth-drift corrections; xlsx upgrade; CSP tightening; KB magic bytes; scope fix for staff customer profile; download audit events; 403 audit events.
2. **Authorization matrix automation:** convert the existing phase-6/7 permission-matrix sections into a CI-executable suite (HTTP-level, seeded roles × routes × department contexts), so every new route lands with a guard test.
3. **IDOR regression:** scripted enumeration over all `[id]` endpoints cross-acting citizens/departments/roles (builds on phase-5 patterns; currently partial).
4. **Dependency gate:** `bun audit`/OSV scan + license scan in CI; replace/upgrade `xlsx`; remove 9 dead deps.
5. **Migration drill:** restore from backup → `migrate deploy` → run suites → verify data integrity (documented runbook exists; execute and record).
6. **Backup-restore drill:** scheduled (documented cron), with restore verification and evidence retention; add orphan-storage reconciliation.
7. **Load test:** SQLite WAL write contention profile under 50–100 concurrent mixed operations; define the scale threshold that triggers the Postgres migration (runbook already in `DATABASE.md`).
8. **AI adversarial eval:** extend `acceptance-v1` with injection corpus + abstention regression; run in CI against a recorded provider or a stub adapter.
9. **Proxy-trust config:** deploy Caddy so `x-forwarded-for` is set only by the trusted edge; add `TRUSTED_PROXIES`-style validation in `src/lib/api.ts` before rate limiting keys on it.
10. **Independent penetration test** before first customer deployment; treat findings against this table.

## 4. Honest assessment

For a v0.9 codebase, the security posture is unusually disciplined (uniform guards, scoped queries, fail-closed AV, exhaustive audit) and the documented threat model in `SECURITY.md` is broadly accurate **with the drift items listed in T2/T3/audit gaps**. The foundation is sound; the listed defects are contained, specific, and fixable without architectural change [R].
