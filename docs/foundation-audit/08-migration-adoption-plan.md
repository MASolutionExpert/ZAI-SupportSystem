# 08 — Migration / Adoption Plan

Two plans are defined. **Plan A (adopt now)** executes the A+D decision. **Plan C (conditional)** is the Chatwoot add-on adoption, executed only after gate approval (Doc 06). Each step names rollback.

## Plan A — continue & upgrade (recommended, immediate)

### Step A0 — Baseline & hygiene (no behavior change)
1. Sync version metadata: `package.json` → 0.9.0 (or bump to 0.10.0 for the hardening release); align docs headers. *Rollback: trivial.*
2. Remove dead deps: `next-auth`, `zustand`, `@tanstack/react-query`, `uuid`, `framer-motion`, `@mdxeditor/editor`, `react-syntax-highlighter`, `sharp`, `next-intl` (zero imports verified [V]). *Rollback: revert package.json.*
3. Delete dead code: `src/lib/kb/{extract,chunking,retrieval}.ts` (zero importers [V]); stale `agent-ctx` notes. *Rollback: git revert.*
4. Demote `db:push --accept-data-loss` script (rename `db:push:dangerous`), keep migration flow canonical. *Rollback: revert.*

### Step A1 — Security hardening (M0 fix list)
1. Replace `Math.random()` password generation with `randomBytes` in `src/lib/admin/users.ts:284-299`, `src/lib/customers/accounts.ts:65-72`.
2. Production-only env: forbid dev fallback when any production signal present (explicit `APP_ENV=production` check in addition to NODE_ENV; refuse boot on missing `AUTH_SECRET` when `APP_ENV=production`), align AUTH_SECRET min length with SECURITY.md (32).
3. Enforce `mustChangePassword` inside `requireAuth`/`requirePermission` (allow only change-password/logout/session routes).
4. Proxy trust: only honor `x-forwarded-for` when the connection arrives from a configured trusted proxy (`TRUSTED_PROXIES` env), else use socket address.
5. Close audit gaps: 403 denials, staff/portal attachment downloads, failed citizen password change, portal-login throttle rejections; fix SECURITY.md drift (secure-cookie claim, "denials audited" claim).
6. CSP: remove `'unsafe-eval'`, move to nonce-based `'unsafe-inline'` where feasible; `typescript.ignoreBuildErrors` → false; KB uploads magic-byte sniff; scope staff customer-profile identity by department; add citizen portal-cookie revocation on password change/reset.
7. Upgrade `xlsx` to ≥0.20.2 or replace with a maintained parser; re-run phase suites + RAG eval.
*Rollback per item: single-commit reverts; DB untouched.*

### Step A2 — Test elevation (CI quality gate)
1. Convert phase-6/7 permission matrix + CSRF cases into a CI-executable suite (HTTP level, seeded roles × routes × departments).
2. Add IDOR enumeration suite (cross-citizen/dept/role over all `[id]` endpoints).
3. Add KB-upload-over-HTTP test; fix phase-4 cleanup (scoped notification deletes); schedule slow throttle scenarios nightly, not per-push.
4. Add `bun audit` + license scan steps. *Rollback: n/a (additive).*

### Step A3 — Email channel (first D-swap)
1. `src/lib/mail/` bridge: inbound IMAP (e.g., `imapflow`) + outbound SMTP (`nodemailer`), mapping inbound mail → ticket create/reply via existing service API; webhook-style loop with DB-backed queue (reuse `RagJob` pattern or a `MailJob` table).
2. Admin config in SystemSetting (encrypted credentials via existing `enc.v1` helpers); per-department routing by recipient address.
3. Tests: parse fixtures (attachments, nested quotes, Persian headers), duplicate-message idempotency, failure quarantine. *Rollback: disable mailbox config.*

### Step A4 — Realtime (SSE)
1. Replace 15–30 s polling with SSE endpoints per surface (conversation stream, inbox stream, notifications), keeping polling fallback for proxies that buffer SSE.
2. Rate-limit SSE connections per IP/token; audit connection creation. *Rollback: feature flag to polling.*

### Step A5 — Embeddings go-live (RAG operational)
1. Configure OpenAI-compatible endpoint in admin AI settings; run `rag:reingest`; verify model/dim mismatch safety; eval must hold 8/8 before enabling AI per department. *Rollback: revert provider to builtin-hashed; settings cache invalidation exists.*

### Step A6 — Scale profile (trigger-gated)
1. Load test (Doc 04 §3.7). If triggered: Postgres migration per `DATABASE.md` runbook; pgvector `VectorIndex` implementation; Redis-backed throttle adapter implementing the existing interface; optional worker process on the same `RagJob` table.
*Rollback: SQLite restore from backup; feature flags.*

## Plan C — Chatwoot multichannel add-on (conditional, gated)

**Precondition:** Gates G1–G3 pass (Doc 06) and a separate written approval is given.

1. **C1 Deploy:** Chatwoot CE pinned release in compose (own PG/Redis), `enterprise/` excluded; TLS via same Caddy; update policy = review release notes → pin bump.
2. **C2 Identity projection:** our portal creates/updates Chatwoot contacts via Platform/Application API with `identifier = citizenId` + HMAC signature (Chatwoot identifier-hash model); citizens never log into Chatwoot; staff console optional (fa) [V fa.yml exists; completeness = G3].
3. **C3 Channel wiring:** external channels (email/WhatsApp/Telegram) terminate in Chatwoot; a sync worker maps Chatwoot conversations ↔ our thread model through webhooks (signature-validated), so our engine remains authoritative for tickets/RAG/audit.
4. **C4 RAG loopback:** new citizen message → webhook → our RAG answer → post back via API; abstain/handoff maps to Chatwoot team assignment. Latency budget ≤ 2 s p95 (G2).
5. **C5 Audit & observability:** Chatwoot actions mirrored into our audit as actorType=SYSTEM events with source tag; no merge of audit stores.
*Rollback: remove compose services + integration module; core app unaffected (integration is additive and behind feature flags).*

## Data migration summary

- Plan A: no data migration (schema continues via migrations).
- Plan C: one-time script maps existing citizens → contacts and open conversations → Chatwoot conversations; dry-run report + checksum verification before cutover; cutover window = stop inbound channels → sync → verify → resume. Rollback: resume channels on core app (Chatwoot stays optional layer).

## Sequencing & approval checkpoints

| Order | Work | Requires |
|---|---|---|
| now→+2w | A0, A1, A2 | **Approval #1/#2 (Doc 00)** |
| +2w→+6w | A3, A4 | in-flight |
| +6w→+8w | A5, ops drills | eval pass |
| later | A6 on trigger | load-test evidence |
| later | C1–C5 | **Approval #3** + gates G1–G3 |
