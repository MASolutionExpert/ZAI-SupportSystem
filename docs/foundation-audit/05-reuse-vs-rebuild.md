# 05 — Reuse vs Rebuild Analysis (Approaches A–E)

The decision question: *where does the product foundation come from?* Approaches are scored against the verified requirement set (Doc 02 §6) and the audit verdict (Doc 01). Per the mandate, no option is favored for sharing our language stack; Ruby/PHP options were evaluated on merit and are reported fairly.

## A. Continue developing the current application

- **Gain:** 100% requirement fit already implemented and verified (Doc 01 §16); single-container ops; no duplicated user system; full control of security cadence; existing test/eval/backup tooling; zero migration cost.
- **Must customize:** hardening fixes (Doc 00 table); email channel (absent today); realtime upgrade; scale-out profile.
- **Must replace:** nothing wholesale; selective component swaps = Approach D below.
- **Must integrate:** optional sidecars (RAGFlow parsing), optional Chatwoot gateway.
- **Must avoid modifying:** `src/lib/rag/**` policy core without eval regression; audit schema semantics.
- **Risks:** single-team security ownership (no external patch stream); SQLite scale ceiling; realtime via polling is v1-grade.
- **Maintenance:** self-owned; bounded by 45k LOC and clean seams.
- **Complexity:** Low. **Security:** good baseline + defined fix list. **Upstream:** n/a (we are upstream).

## B. Fork a mature application and customize it

Evaluated: Zammad (AGPL), Chatwoot (MIT core), FreeScout (AGPL).

- **Gain:** battle-tested channel handling, assignment/automation depth, upstream-tested core.
- **Must customize:** کد ملی citizen identity (no equivalent anywhere), Persian RTL portal, strict CRAG RAG bridge, department-scoped retrieval policy, 52-key RBAC equivalents, audit granularity — i.e., **the differentiating majority of the product is rebuilt either way** [R — this is the pivotal fact].
- **Must replace:** our portal, RAG engine, citizen identity, much of the operator UX (or accept English/other-locale console).
- **Must integrate:** two user systems or a projection pattern; two databases; webhooks loopback.
- **Must avoid modifying:** core (AGPL forces disclosure if modified and served; fork = permanent divergence from upstream security patches).
- **Risks:** AGPL obligations (Zammad/FreeScout) — a legal gate, not an engineering one; Ruby/PHP stack split for the team; Chatwoot fork forfeits cheap upstream updates; hidden second AI/identity subsystems.
- **Maintenance:** long-term fork burden is the worst of all options; security patches must be re-merged onto heavy local mods.
- **Complexity:** High. **Security:** inherits upstream fixes only while divergence is small — directly contradicted by the customization depth needed. **Upstream compatibility:** poor.
- **Verdict [R]: Rejected.** The fork would be larger than the product.

## C. Use a mature application as the core and integrate other systems through APIs

Evaluated: Chatwoot as conversation/channel core; Zammad as ticketing core.

- **Gain:** multichannel inboxes (email/WhatsApp/Telegram/FB), realtime console, contact management, webhooks, active upstream (commit "today" [V]); Chatwoot Persian+RTL verified in-tree [V].
- **Must customize:** portal stays ours (کد ملی identity projects into Chatwoot contacts via identifier+HMAC); RAG stays ours behind a webhook/API loopback; operator adoption of Chatwoot console (fa) vs keeping ours.
- **Must replace:** our conversation/ticket engine **or** run parallel engines (bad); notification/assignment semantics re-derived.
- **Must integrate:** Widget/Application/Platform APIs; identity sync; RAG loopback; audit unification (two audit stores).
- **Must avoid modifying:** `enterprise/` dir; core fork.
- **Risks:** Postgres+Redis infra + Rails ops; duplicated audit/notification systems; latency loopback for AI answers; lock-in to API surface changes (mitigated by pinning releases).
- **Maintenance:** upstream updates preserved while integration stays API-only — good.
- **Complexity:** Medium-High now; **Low** as an add-on gateway later.
- **Verdict [R]: not the core today** (would discard verified code and duplicate systems), **but the correct pattern for the multichannel add-on** once email/WhatsApp/Telegram consolidation is required. Gated by 3 spikes (Doc 08 Plan C).

## D. Replace only specific subsystems with mature independent components

Subsystem-level swaps on top of A (each preserves the architecture's existing seams):

| Subsystem | Today [V] | Mature replacement/upgrade | Cost | Trigger |
|---|---|---|---|---|
| Email channel | absent entirely | IMAP/SMTP bridge using proven libraries (e.g., `nodemailer` + `imapflow`) or a dedicated inbound mail service (Postal/Haraka class) writing tickets via internal API | M | customer email requirement |
| Rate limiting & shared cache | in-memory Maps | Redis-backed adapter behind existing `throttle.ts` interface | S | multi-replica deploy |
| Database | SQLite (WAL) | PostgreSQL via documented runbook (`DATABASE.md`) + pgvector behind `VectorIndex` | M | scale threshold (load test, Doc 04 §3.7) |
| Embeddings | `hashed-fa-v1` fallback | real OpenAI-compatible `/embeddings` endpoint (already configurable) | S | before production RAG go-live |
| Realtime | 15–30 s polling | SSE (or WebSocket mini-service) for chat/inbox | M | operator UX requirement |
| Document parsing (scanned PDFs/OCR) | text-layer PDFs only | RAGFlow (Apache-2.0) as sidecar feeding normalized text into our ingest | M | scanned-corpus requirement |
| Error tracking | console-only | Sentry/GLM-compatible collector | S | production launch |

- **Verdict [R]: adopt as the primary execution pattern** — targeted, seam-respecting, keeps upstream-update ability only where it exists (libraries), avoids duplicated user systems.

## E. Build from scratch where no mature foundation exists

Applies to: citizen national-ID identity, strict CRAG policy engine, Persian RTL portal, fair-distribution desk — **these were built from scratch and verified** (no mature OSS provides them; Doc 02). No further from-scratch scope is justified. **Verdict: already satisfied; no new greenfield work [R].**

## Scoring matrix (1–10; weights in parentheses)

| Criterion (weight) | A (current) | B fork Zammad | B′ fork Chatwoot | C Chatwoot core | D A+swaps | E scratch |
|---|---:|---:|---:|---:|---:|---:|
| Requirement fit (25) | 10 | 6 | 7 | 7 | 10 | 5† |
| Security track record & patch stream (20) | 6 | 8 | 8 | 8 | 7 | 3 |
| License (10) | 10 | 3 | 8 | 8 | 10 | 10 |
| Customization cost, inverse (15) | 8 | 3 | 4 | 5 | 8 | 1 |
| Upstream alignment (10) | 10 | 3 | 4 | 8 | 10 | 10 |
| Ops footprint, inverse (10) | 9 | 4 | 4 | 5 | 9 | 5 |
| Migration cost, inverse (10) | 10 | 2 | 3 | 4 | 10 | 1 |
| **Weighted total** | **9.1** | **4.5** | **5.6** | **6.6** | **9.3** | **4.5** |

† E scores assume the rebuild actually re-achieves current verified behavior (uncertain).

**Conclusion [R]:** D (A + targeted swaps) is the highest-scoring path; C is the right pattern deferred to a gated add-on; B and E are rejected. This is not nostalgia for existing code — it follows from two verified facts: (1) the custom surface is the product's majority and exists in no candidate; (2) the current core passed an adversarial audit with a contained, fixable defect list.
