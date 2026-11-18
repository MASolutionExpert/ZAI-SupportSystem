# 06 — Recommended Foundation

## Decision

**Adopt Approach A+D:** the current SupportDesk application is the product foundation; specific subsystems are upgraded/replaced with mature components per the seam-respecting swap table (Doc 05 §D). An **Option C add-on** (Chatwoot as multichannel gateway, API-only integration, unmodified upstream) is pre-approved *in design* but gated on three spikes and an explicit future approval.

## Why this is the reuse-first answer (and not NIH)

1. **Reuse where mature code exists and fits:** libraries and sidecars for email, Redis-backed limiting, Postgres/pgvector, real embeddings, OCR parsing (RAGFlow), error tracking. Every swap lands on an existing abstraction seam (`throttle` interface, `VectorIndex` factory, `AiProviderAdapter`, `StorageDriver`) [V].
2. **Do not duplicate:** adopting Zammad/Chatwoot as the core would create a second user system (citizens vs contacts), a second AI subsystem (Captain/none vs our CRAG), and a second audit/notification pipeline — the exact duplication the architecture rules forbid.
3. **Verified evidence, not familiarity bias:** the current core survived an adversarial audit (82 routes, every mutation guarded, no IDOR found, fail-closed AV, exhaustive audit log) with a contained defect list [V]. None of the helpdesk candidates could absorb our verified custom surface; none ships کد ملی identity or our CRAG policy [V — Doc 02].
4. **License-clean path:** no AGPL enters the core; the add-on is MIT with a documented `enterprise/` exclusion (Doc 03).
5. **Language-stack honesty:** Chatwoot/Zammad were *not* rejected for being Ruby. They were rejected on requirement fit, duplication cost, and AGPL/divergence risk; Chatwoot is explicitly retained as the best-in-class add-on precisely because it is the strongest candidate overall.

## What we keep (ownership retained)

| Capability | Why kept |
|---|---|
| Conversation engine + handoff + fair distribution | Verified, concurrency-tested, department-scoped |
| Tickets portal + کد ملی citizen identity (AES-GCM + HMAC) | No OSS equivalent; already implemented (Phase 8) |
| RAG engine (hybrid, CRAG, citations, abstention, eval) | Policy-critical; implemented; abstraction seams for scale |
| RBAC (52 keys), audit log, file hub + AV | Verified and load-bearing |
| Docker/Caddy/CI/release/ops-CLI/backup stack | Complete ops story for single-node deployments |

## What we upgrade (the D-swap list, execution order)

1. **M0 hardening fixes** (Doc 00 table) — prerequisite for everything.
2. **CI test elevation** — run existing phase suites + new authz matrix in CI.
3. **Email channel** — proven library bridge into `tickets.create.internal`/portal paths.
4. **Realtime** — SSE upgrade for chat/inbox (fallback polling retained).
5. **Embeddings go-live** — configure a real OpenAI-compatible endpoint; re-embed via existing `RagJob` queue.
6. **Scale profile** — Postgres + pgvector + Redis adapter behind existing interfaces, triggered by load-test thresholds, using the `DATABASE.md` runbook.
7. **Optional sidecars** — RAGFlow parsing for scanned PDFs; Sentry-class error tracking.

## Decision gates for the Chatwoot add-on (must all pass before adoption commitment)

1. **Gate G1 — Infra:** Chatwoot self-hosted runs in the target environment (Postgres + Redis provisioned, resource budget accepted).
2. **Gate G2 — Identity & API:** Widget/Application API creates conversations as identified contacts from our citizen identities (identifier + HMAC signature), dept/label mapping to our departments works, webhook loopback latency for RAG answers ≤ 2 s p95.
3. **Gate G3 — Locale & console:** Chatwoot console fa locale completeness acceptable for operators; RTL verified in UI; dual-audit story accepted.

If any gate fails → the add-on is deferred and the gap is closed natively (email bridge + SSE) [R].

## Explicitly rejected (do not revisit without new evidence)

- Forking Zammad/FreeScout (AGPL + divergence + rebuild of custom surface) — Doc 05 §B.
- Adopting Peppermint (archived 2025-09-21 [V]) or qragy (AGPL, 4★ [V]).
- Replacing the RAG engine with RAGFlow/Onyx/FastGPT as the policy brain (RAGFlow retained only as an optional Apache-2.0 parsing sidecar).
- Any from-scratch rewrite beyond current scope (E) — already satisfied.

## Consequences on the previously planned work

- The "ticket user (کد ملی) system" previously queued for implementation **already exists** (Phase 8, commit `2a2315c` [V]); its open items reduce to hardening entries (`mustChangePassword` API enforcement, portal-cookie revocation, audit gaps) in M0.
- The 7-stage RAG plan is complete (Doc 01 §11); remaining RAG work is operational (real embeddings, eval expansion, scale-out seams) — no rewrite.

## Approval requested

See Doc 00 §"Decisions requested". Implementation remains stopped until written approval.
