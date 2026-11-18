# 10 — Implementation Roadmap

Post-approval sequence. Nothing below starts before written approval (Doc 00). Milestones map to Plan A steps (Doc 08) and gates (Doc 06).

## M0 — Hardening & hygiene (≈2 weeks)
**Goal:** close every Med/Med-High finding; make the repo audit-clean.
- A0: version sync; remove 9 dead deps; delete dead KB modules; demote `db:push`.
- A1: all Doc 00 fix-list items (randomness, env fail-fast, `mustChangePassword`, proxy trust, audit-gap closure, SECURITY.md truth alignment, CSP, KB magic bytes, staff profile scoping, portal-cookie revocation, xlsx upgrade).
- A2: CI elevation (authz matrix suite, IDOR suite, KB upload test, `bun audit` + license scan).
- **Acceptance:** all phase suites pass; new suites green in CI; lint/typecheck clean; zero dead deps; SECURITY.md matches code (spot-audit).

## M1 — Ops readiness (≈1 week, parallel with late M0)
- Scheduled backup in-repo example + install checklist; first recorded restore drill.
- Orphan-storage reconciliation job; audit-write health signal.
- Release checklist: migrations only, eval run, suites run, license scan.
- **Acceptance:** restore drill evidence stored; ops runbook updated.

## M2 — Email channel (≈3 weeks)
- Inbound IMAP → tickets/replies; outbound SMTP notifications; quarantine + idempotency; per-department routing; encrypted credentials.
- **Acceptance:** end-to-end test with real mailbox (Persian headers, attachments); failure paths audited; suites green.

## M3 — Realtime (≈2 weeks)
- SSE for chat/inbox/notifications with polling fallback; connection limits.
- **Acceptance:** sub-second operator reply visibility; polling fallback verified behind buffering proxy; load sanity at 100 concurrent streams.

## M4 — RAG production embedding (≈1 week)
- Real embeddings endpoint configured; `rag:reingest`; eval gate 8/8 (extended corpus incl. injection cases); department-by-department enablement.
- **Acceptance:** recall@5 ≥ baseline on real corpus; degraded-mode trace no longer default.

## M5 — Scale profile (trigger-gated)
- Load-test evidence → Postgres + pgvector + Redis throttle adapter (+ optional worker process) per runbooks.
- **Acceptance:** data migration checksum-verified; suites green on Postgres profile; rollback rehearsed.

## M6 — Chatwoot multichannel add-on (conditional; gated by G1–G3 + approval #3)
- C1–C5 per Doc 08 Plan C: deploy CE pinned, identity projection, channel wiring, RAG loopback ≤2 s p95, audit mirroring.
- **Acceptance:** citizens authenticate only in our portal; one identity source; `enterprise/` excluded (verified at image level); rollback rehearsal done.

## Continuous (from M0 onward)
- Weekly: dependency/OSV review. Per release: migrations-only, eval run, suites, license scan, doc-drift spot-check.
- Quarterly: backup-restore drill; threat-model review against Doc 04 table.

## Milestone dependency map

```
M0 ──► M1 ──► M2 ──► M4 ──► M5(trigger)
 │
 └──► M3 ─────────────┘
              (M6 gated, parallel-eligible after M1)
```

## Deferred/backlog (not scheduled)
- SMS/OTP channel (was replaced by citizen passwords in Phase 8 [V]) — only if funded.
- Multi-language UI beyond Persian/English admin.
- Mobile client.
