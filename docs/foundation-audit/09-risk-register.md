# 09 — Risk Register

Scale: Likelihood (L) and Impact (I) 1–5; Exposure = L×I. Owner roles: ENG (engineering), SEC (security), OPS (operations), LEG (legal/compliance), PM.

| ID | Risk | L | I | Exp | Mitigation | Owner | Status |
|---|---|---:|---:|---:|---|---|---|
| R-01 | `Math.random()` temp passwords predictable in adversarial context | 2 | 4 | 8 | M0 fix → `randomBytes`; force change on first use (already sets `mustChangePassword`) | SEC | Open → A1 |
| R-02 | Dev fallback secrets active if a production process starts with wrong NODE_ENV | 2 | 4 | 8 | A1.2 explicit `APP_ENV=production` fail-fast; entrypoint already sets NODE_ENV [V] | SEC | Open → A1 |
| R-03 | `mustChangePassword` bypass via API with live session | 2 | 3 | 6 | A1.3 guard in `requireAuth` | SEC | Open → A1 |
| R-04 | Rate-limit bypass via `x-forwarded-for` spoofing; limiter resets on restart | 3 | 3 | 9 | A1.4 trusted-proxy config; Redis adapter in scale profile; edge limiter at Caddy | SEC | Open → A1/A6 |
| R-05 | SECURITY.md drift misleads operators (claims controls that differ from code) | 3 | 2 | 6 | A1.5 doc/code reconciliation; add doc-drift check to release checklist | SEC | Open → A1 |
| R-06 | `xlsx@0.18.5` known CVE class parsing untrusted uploads | 2 | 3 | 6 | Upgrade/replace (A1.7); KB uploads admin-gated [V] reduces exposure | ENG | Open → A1 |
| R-07 | SQLite write contention under load; silent degradation | 2 | 3 | 6 | Load test gate (Doc 04 §3.7); Postgres runbook ready (`DATABASE.md`) | ENG | Monitored → A6 |
| R-08 | In-memory caches/rate limits break multi-replica assumptions | 2 | 3 | 6 | Single-node documented [V]; Redis adapter behind interface when scaling | ENG | Monitored → A6 |
| R-09 | No email/SMS channel = unmet operational expectation for a "helpdesk" | 3 | 3 | 9 | A3 email bridge; SMS stays out of scope unless funded | PM | Open → A3 |
| R-10 | Polling realtime hurts operator UX at scale | 3 | 2 | 6 | A4 SSE with polling fallback | ENG | Open → A4 |
| R-11 | RAG answers degrade if production embeddings not configured (hashed fallback) | 3 | 3 | 9 | A5 go-live + eval gate per department; honest UI/trace already distinguishes degraded mode [V] | ENG | Open → A5 |
| R-12 | Chatwoot add-on: accidental `enterprise/` enablement (license breach) | 1 | 4 | 4 | Image-level exclusion; deployment checklist; only CE features enabled | LEG | Gated (Plan C) |
| R-13 | Chatwoot add-on: identity split (contacts vs citizens) causes data drift | 2 | 3 | 6 | Projection pattern with our side authoritative; sync reconciliation report; dry-run migration | ENG | Gated (Plan C) |
| R-14 | AGPL contamination if anyone pastes Zammad/FreeScout/qragy code into core | 1 | 5 | 5 | License scan in CI (A2.4); compliance decision recorded (Doc 03); team guidance | LEG | Mitigation in A2 |
| R-15 | Backup never actually scheduled/restored in real deployment | 2 | 4 | 8 | Quarterly restore drill with evidence (Doc 07 §7); ops checklist on install | OPS | Open → M1 |
| R-16 | Audit-log silent failure (writer swallows errors) weakens evidentiary chain | 2 | 3 | 6 | A1.5: add health signal + alert on audit write failure; keep best-effort semantics deliberate | SEC | Open → A1 |
| R-17 | Dependency supply-chain (npm) compromise | 2 | 4 | 8 | `bun audit`/OSV in CI, frozen lockfile (already [V]), pin versions, renovate-class updates | ENG | Open → A2 |
| R-18 | Prompt-injection corpus evolves beyond current hardening | 2 | 3 | 6 | Extend eval set (Doc 04 §3.8); abstention regression mandatory per engine change | ENG | Open → A5 |
| R-19 | Team capacity: single-team ownership without external patch stream | 3 | 3 | 9 | Elevated CI; dependency automation; this audit's contained fix list; add-on pattern avoids forks | PM | Accepted |
| R-20 | Sandbox/dev-environment constraints (single port, SQLite) misread as product limits | 3 | 2 | 6 | Docs clarify profile 1/2/3 (Doc 07); production exposes standard ports via Caddy | PM | Mitigated (this doc set) |

## Top exposures to address first

1. R-04 (proxy trust + shared limiter) — operational security hinge.
2. R-09 (email absence) — biggest functional gap vs. product expectations.
3. R-11 (embeddings go-live) — determines real RAG quality in production.
4. R-15 (backup drills) — cheapest catastrophic-loss prevention.
