# 00 — Executive Summary: Foundation Audit & Decision

**Audit date:** 2026-11-17 (sandbox clock)
**Subject:** SupportDesk repository `/home/z/my-project` (Next.js 16 App Router + TypeScript + Prisma/SQLite, VERSION file 0.9.0)
**Mode:** Research only. No application code was modified.

**Legend used across all documents:**
- **[V]** Verified fact (direct file inspection, live HTTP probe, or fetched artifact)
- **[A]** Assumption (stated basis; must be confirmed before reliance)
- **[U]** Unverified claim (third-party or memory; flagged for verification)
- **[R]** Recommendation (judgment, not fact)

---

## Verdict on the current repository

The current implementation is **not a mock or a superficial feature shell**. Source inspection [V] found:

- 279 TS/TSX source files, ~45,300 lines; 33 Prisma models; 7 versioned migrations; 82 API route files.
- **Zero** TODO/FIXME/stub/mock/"not implemented" markers in `src/` (68 grep hits are all UI `placeholder=` attributes or informative comments).
- Uniform response envelope + zod validation + an origin/CSRF guard present on **every** mutating route (verified across all 77 route files with mutations).
- Deny-by-default RBAC (52 permission keys, DENY-wins overrides, department scoping re-checked per resource access). No IDOR found in the reviewed `[id]` route set; one low-severity partial-scoping leak documented.
- Real DB-backed sessions (SHA-256-hashed tokens, revocable), bcrypt cost 12, DB-persisted lockout, exhaustive audit logging (80+ action types).
- Real ClamAV clamd client (fail-closed), magic-byte upload verification, quota chain, path-traversal-guarded storage root.
- The 7-stage RAG engine is **implemented** (hybrid lexical+vector+RRF, Corrective-RAG with bounded loop, citation-verified generation, DB-backed job queue, eval harness, 8/8 acceptance baseline), and the کد ملی citizen account system is **implemented** (AES-256-GCM encrypted national ID + keyed HMAC equality index, signed portal cookie).
- Docker + docker-compose + Caddy overlay, CI (lint/typecheck/build), release workflow to ghcr, ops CLI with backup/restore, and a 10-document operations/docs set.

However, it is **not yet production-hardened**. The audit found a small set of genuine defects (§ Security), the most important being a `Math.random()`-based temporary-password generator and several config/protocol trust issues. See `01-repository-audit.md` and `04-security-assessment.md`.

## Recommendation (short form)

**Adopt Approach A+D: continue the current application as the product foundation, and replace specific weak subsystems with mature components or services** — with a **phase-gated Option C add-on** (Chatwoot as a multichannel inbox gateway, integrated via APIs only, never as a forked core).

1. **Keep** the verified conversation/ticket/portal/RAG core. Re-platforming to Zammad/Chatwoot would force a second user system (violating the no-duplicated-user-systems constraint), a second AI subsystem, a Ruby/PHP stack split, and — for Zammad/FreeScout — AGPL obligations, while the differentiating 60% of the product (کد ملی identity, Persian RTL portal, strict CRAG policy, department-scoped retrieval, 52-key RBAC, audit granularity) is **custom code in every scenario**.
2. **Replace/upgrade subsystems** where mature components beat current code: email channel (none exists today), shared rate-limit/cache backend (currently per-process in-memory), Postgres migration path (documented runbook exists; `VectorIndex` and provider seams already exist), a real embedding endpoint for the RAG engine (already configurable), SSE/WebSocket for realtime (currently 15–30 s polling).
3. **Conditional add-on:** Chatwoot (MIT core, verified Persian `fa.yml` + widget `fa.json` + official full-RTL support) as an external channel gateway behind our identity system, adopted only after 3 decision-gate spikes pass.
4. **Never:** fork qragy (AGPL-3.0, 4 stars [V]), adopt Peppermint (archived 2025-09-21 [V]), or replace the working RAG engine with RAGFlow/Onyx/FastGPT as the policy brain (optional Apache-2.0 parsing sidecar role only).

## Defects that must be fixed before production (approved-fix list, no code changed yet)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **Med-High** | Temporary passwords generated with `Math.random()` (CSPRNG `randomBytes` used elsewhere) | `src/lib/admin/users.ts:284-299`, `src/lib/customers/accounts.ts:65-72` |
| 2 | Med | Dev fallback secrets incl. known superadmin password active whenever `NODE_ENV!=="production"`; `NODE_ENV` itself defaults to `development` | `src/lib/env.ts:9-11,72-96` |
| 3 | Med | `mustChangePassword` not enforced at API layer (only page shells) | `src/lib/api.ts:196-222` vs `src/components/shell/staff-shell.tsx:24` |
| 4 | Med | Rate limiter keys on first `x-forwarded-for` hop unconditionally; limiter/cache in-memory per process | `src/lib/api.ts:39-42`, `src/lib/auth/throttle.ts:15` |
| 5 | Med | SECURITY.md drift: claims "authorization denials audited" (they are not) and `x-forwarded-proto` cookie logic (code uses NODE_ENV) | `SECURITY.md:43,37` vs `src/lib/audit.ts`, `src/lib/auth/session.ts:36-39` |
| 6 | Low | `xlsx@0.18.5` parses untrusted KB uploads; predates CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS) fixes | `package.json:90`, `src/lib/rag/ingest/extract.ts:232` |
| 7 | Low | CSP allows `'unsafe-inline' 'unsafe-eval'`; AUTH_SECRET min length 16 vs documented 32; KB uploads lack magic-byte sniffing; staff customer-profile identity unscoped; citizen portal cookie (30-min HMAC) not revocable on password change; resume token in URL | `next.config.ts:38`, `src/lib/env.ts:15`, `src/lib/kb/pipeline.ts:46-68`, `src/lib/tickets/service.ts:1489-1502`, `src/lib/customers/session.ts`, `src/lib/conversations/service.ts:543` |
| 8 | Ops | Version drift 0.9.0 (VERSION) / 0.4.0 (package.json) / 0.7.0 (docs); 9 declared-but-unused deps incl. `next-auth`; ~17 thin handlers without try/catch envelope; `db:push --accept-data-loss` coexists with migration policy; no tests executed in CI | `VERSION`, `package.json:3`, route files, `.github/workflows/ci.yml` |

## Documents in this set

| # | Document |
|---|---|
| 01 | Current repository audit |
| 02 | Candidate project comparison |
| 03 | License and compliance findings |
| 04 | Security assessment (threat model + verification strategy) |
| 05 | Reuse versus rebuild analysis (Approaches A–E) |
| 06 | Recommended foundation |
| 07 | Proposed architecture |
| 08 | Migration / adoption plan |
| 09 | Risk register |
| 10 | Implementation roadmap |

## Decisions requested (approval gate — implementation is STOPPED here)

1. **Approve the foundation decision:** Approach A+D with the phase-gated Chatwoot add-on (Doc 06).
2. **Approve M0 hardening scope** (fixes table above + test elevation) as the first implementation phase after approval (Doc 10).
3. **Approve the three decision-gate spikes** that must run before any Chatwoot adoption commitment (Doc 08, Plan C).

Until written approval is received, no application code will be changed.
