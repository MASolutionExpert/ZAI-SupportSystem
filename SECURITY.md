# SECURITY.md — Support Desk

Status: **Phase 7 (Production Hardening) — final as-built** covering phases 1–7. This document maps the implemented controls of all shipped phases to the master specification's security requirements (§10), records the Phase 7 hardening-test results, and documents credential rotation/recovery. Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md), [PERMISSIONS.md](PERMISSIONS.md).

---

## 1. Threat model summary

| # | Threat | Vector | Phase 1 posture |
|---|---|---|---|
| T1 | Credential brute force / password spraying | Repeated `POST /api/auth/login` | **Mitigated:** per-IP sliding-window throttle (10/min) + persistent account lockout (5 failures → 15 min lock, configurable) |
| T2 | Session theft / replay | Cookie exfiltration, DB leak | **Mitigated:** httpOnly + SameSite=Lax + Secure cookies; tokens stored only as SHA-256 hashes (DB leak yields no usable tokens); server-side revocation; TTL expiry |
| T3 | Privilege escalation via forged requests | Calling admin APIs without rights | **Mitigated:** deny-by-default RBAC enforced in backend guards on every API route and server component; no role-name shortcuts |
| T4 | CSRF | Cross-site form/auto-post against mutating endpoints | **Mitigated:** same-origin enforcement on mutating APIs + SameSite=Lax session cookie |
| T5 | SQL injection | Malicious inputs reaching queries | **Mitigated:** Prisma ORM parameterized queries exclusively; no raw string-concatenated SQL |
| T6 | XSS | Injected markup rendered in UI | **Mitigated:** React auto-escaping; no `dangerouslySetInnerHTML` for user content; CSP header as defense-in-depth |
| T7 | Clickjacking / content-type sniffing / referrer leakage | Framing, MIME confusion, Referer headers | **Mitigated:** security headers via `next.config` (§3) |
| T8 | Config/secret leakage | Misdeclared env, secrets in logs/code | **Mitigated:** Zod-validated env (`src/lib/env.ts`) fails fast; secrets only via environment; audit writer never logs secrets or raw PII |
| T9 | Weak/bootstrap credentials persisting | Initial super admin never rotated | **Mitigated:** forced password change on first login; bootstrap never overwrites an existing super admin; recovery procedure in §6 |
| T10 | Unauthorized file access (direct URL guessing) | Static serving of uploads | **Mitigated (Phase 5):** files stored outside the web root under randomized server-side keys; `/storage/…` is never served (verified 404); downloads only via permission- and scope-checked backend endpoints; path-traversal keys rejected by the storage guard |
| T11 | Customer identity (national ID) exposure | URLs, logs, public APIs | **Mitigated (Phase 4):** AES-256-GCM encryption at rest (`APP_ENCRYPTION_KEY` outside the DB) + keyed HMAC lookup index; never in URLs/logs/APIs/errors; portal access only after OTP verification; server-side hard filters (internal notes excluded from customer views *and* counts) |
| T12 | Prompt injection / AI knowledge leakage | Customer messages, KB documents | **Mitigated (Phase 3, re-verified Phase 7):** retrieval department-scoped before any provider call; hardened Persian system prompt treats retrieved/customer content as data-not-commands; strict grounding with exact-message abstention; provider errors sanitized (keys/`Bearer` redacted); injection attempts verified neutralized in the Phase 7 suite |
| T13 | Storage exhaustion (upload bombs) | Oversized/frequent uploads | **Mitigated (Phase 5):** per-file cap ≤ operator quota ≤ department quota ≤ total capacity chain validated on save; cumulative batch checks before storage; extension allowlist + content-based MIME verification; optional mandatory ClamAV scanning that fails closed |

---

## 2. Implemented controls — mapping to master spec §10

| Spec §10 requirement | Implementation (Phase 1) |
|---|---|
| Secure authentication & session management | Custom DB-backed sessions (`src/lib/auth/session.ts`): 32-byte CSPRNG tokens, stored **only** as SHA-256 hashes (`Session.tokenHash`, unique index), `expiresAt` from `SESSION_TTL_HOURS` (default 168 h), `revokedAt` for server-side revocation, `ip`/`userAgent` recorded. |
| Strong password hashing | bcryptjs, cost 12 (`src/lib/auth/password.ts`). Plaintext never stored or logged; `SUPERADMIN_PASSWORD` is used only at bootstrap to write the hash. |
| Password policy | Change-password requires ≥12 characters with upper + lower + digit; verifies the **current** password first. |
| Session expiration & revocation | Logout revokes the current session; successful password change revokes **all other** sessions; expired/revoked rows are rejected by validation. |
| Forced credential rotation | `mustChangePassword` forces the initial super admin through `/change-password` before any other use. |
| Login throttling & abuse protection | `src/lib/auth/throttle.ts`: in-memory sliding window — 10 login attempts/min/IP (429 on excess); account lockout persisted on `User.failedLoginAttempts` / `User.lockedUntil` — lock after `LOGIN_MAX_ATTEMPTS` (5) failures for `LOGIN_LOCK_MINUTES` (15). |
| Secure cookie settings | Cookie `sd_session`: httpOnly, SameSite=Lax, Secure set automatically when the request arrives over TLS (`x-forwarded-proto`); `FORCE_SECURE_COOKIES` forces Secure behind unusual proxies. |
| CSRF protection | Same-origin enforcement on every mutating API request (checked in `src/lib/api.ts`) combined with SameSite=Lax cookies. GET endpoints perform no state changes. |
| Input validation | Zod 4 on every request body and on the environment itself (`src/lib/env.ts` fails fast on bad config). |
| SQL injection protection | Prisma ORM with parameterized queries only (no raw SQL in Phase 1). |
| XSS protection | React server rendering with automatic escaping; UI renders Persian strings and whitelisted lucide icons; CSP header as a second layer. |
| Strict server-side authorization | Deny-by-default RBAC (`src/lib/rbac/service.ts`): effective permissions = role bindings ∪ per-user overrides; **DENY wins**; cached 30 s. Enforced by `requireAuth` / `requirePermission` in **both** API route handlers and server components — never by hiding UI (spec §9.4/§11). Catalog: [PERMISSIONS.md](PERMISSIONS.md). |
| Audit logging | `src/lib/audit.ts` → `AuditLog` (actorType, actorUser, actorLabel snapshot, action, entityType/Id, metadata JSON, ip, userAgent). Phase 1 audited events: authentication success/failure, logout, password change, authorization denials, and bootstrap (`system.bootstrap.*`, e.g. `system.bootstrap.superadmin`). Never logs secrets or raw PII. |
| Secrets management | Only via environment variables, validated at startup. `AUTH_SECRET` ≥32 chars; `APP_ENCRYPTION_KEY` reserved (32-byte base64) and never committed; nothing secret is embedded in code or client bundles. |
| Secure HTTP headers | Via `next.config`: X-Frame-Options `DENY`, X-Content-Type-Options `nosniff`, Referrer-Policy `strict-origin-when-cross-origin`, minimal Permissions-Policy, and a pragmatic CSP — see table in §3. |
| Safe error handling | One response envelope (`src/lib/api.ts`); errors return generic messages with no stack traces, secrets, or personal data to clients; details go to server logs only. |
| Health endpoint without leakage | `GET /api/health` returns 200/503 status with no secrets or internal details. |
| Brute-force protection | See throttling row above; lockout is data-backed so it survives process restarts. |
| Database backup protection | Operational procedure — see [BACKUP-RESTORE.md](BACKUP-RESTORE.md) (maintained separately). SQLite v1 means the DB is a single file that must be protected at the OS level like any secret. |

### Cookie & session reference

| Property | Value |
|---|---|
| Cookie name | `sd_session` |
| Cookie value | Raw session token: 32 random bytes (CSPRNG) |
| Server-side storage | `Session.tokenHash` = SHA-256(token) — the raw token is never persisted |
| httpOnly | Yes |
| SameSite | Lax |
| Secure | Automatic via `x-forwarded-proto`; forced with `FORCE_SECURE_COOKIES` |
| Lifetime | `SESSION_TTL_HOURS` (default 168 = 7 days), persisted as `expiresAt` |
| Revocation | Logout (current session); password change (all other sessions); `revokedAt` recorded |
| Validation | Every request: hash token → unique lookup → check `revokedAt`/`expiresAt` → user `status = ACTIVE` |
| Failure/lockout counters | `User.failedLoginAttempts`, `User.lockedUntil` (reset on successful login) |

---

## 3. HTTP security headers (Phase 1, via `next.config`)

| Header | Value | Purpose |
|---|---|---|
| `X-Frame-Options` | `DENY` | Blocks clickjacking by forbidding framing. |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage to cross-origin targets. |
| `Permissions-Policy` | Minimal allow-list (camera, microphone, geolocation denied) | Disables powerful browser APIs the app does not use. |
| `Content-Security-Policy` | Pragmatic policy allowing Next.js's own inline/runtime needs while restricting remote origins | Defense-in-depth against XSS; tightened per-phase as features land. |

---

## 4. Planned security controls — final status (all shipped phases)

| Control | Phase | Status / Design reference |
|---|---|---|
| Upload security: content-based MIME sniffing, extension allowlists, randomized server-side file identifiers, path-traversal protection, files outside web root, authorized download endpoints only | ~~Phase 5~~ **Implemented** | Full pipeline for ticket attachments (Phase 4) and the shared file hub (Phase 5); storage seam in [ARCHITECTURE.md](ARCHITECTURE.md) §6 |
| Antivirus scanning integration point (configurable scanner such as ClamAV); uploads not marked safe when mandatory scanning fails | ~~Phase 5~~ **Implemented** | ClamAV clamd INSTREAM client; mandatory-scan semantics with fail-closed on daemon errors; honest `SKIPPED` state when `provider=none` |
| Upload/download quotas & storage-exhaustion prevention | ~~Phase 5~~ **Implemented** | Ticket attachments capped (Phase 4); hub-level capacity/department/operator quota chain (Phase 5) |
| Customer identity: app-level **AES-256-GCM** encryption of national IDs (`APP_ENCRYPTION_KEY` stored outside the DB) + **keyed HMAC (SHA-256)** lookup index — never a primary key, never exposed in URLs/logs/APIs/error messages | ~~Phase 4~~ **Implemented** | [DATABASE.md](DATABASE.md) §6 — `CustomerProfile.nationalIdEnc` + `nationalIdHmac` (scrypt domain-separated key) |
| ~~OTP (or equivalent) identity verification before showing customer history~~ **REPLACED in Phase 8 by product decision** — citizen password accounts: کد ملی + password set at first contact (bcrypt cost 12; lighter public-portal policy 8+ chars with letters+digits), login throttled per IP and per identity (keyed by the non-reversible HMAC), timing-equalized against non-existent accounts, 30-min signed httpOnly session cookie still required for every history read | Phase 8 | `src/lib/customers/accounts.ts` (`authenticateCitizen` / `resolveCitizenIdentity`); OTP model + routes removed; SMS never shipped — see [DATABASE.md](DATABASE.md) §6 |
| Citizen account administration (کاربران سامانه) | Phase 8 **Implemented** | `/admin/citizens` behind `admin.citizens.manage` (SUPER_ADMIN auto-bound): edit name, password reset (plaintext returned ONCE in the response; never stored/audited), block/unblock (`CustomerProfile.status`), delete with ticket/conversation preservation via `SetNull`; every action audited (`admin.citizen.*`) |
| Per-department / per-feature rate limits beyond login (conversations, uploads, AI calls) | Phases 3–5 | **Implemented (per-process):** conversations (10/h/IP, 20 msgs/5 min), AI daily limits per department, OTP requests, portal ticket creation, login (10/min/IP) + persistent account lockout; shared multi-node limiting arrives with the PostgreSQL scale-out path |
| AI security: prompt-injection defenses (customer messages and KB documents are untrusted input), department-scoped retrieval applied before sending context to the provider, server-side credentials, no system-prompt/key disclosure, AI cannot perform administrative actions | ~~Phase 3~~ **Implemented** | [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md); injection/abstention/scoping re-verified in the Phase 7 suite |
| Fair-distribution and assignment audit trails, operator availability controls | ~~Phase 4~~ **Implemented** | Every assignment decision audited with candidate-load stats (`ticket.assign.*`); `User.isAvailable` gates candidacy; per-operator active-load cap per department |
| Formal security review, permission-matrix testing, upload security testing, AI/prompt-injection testing, backup/restore and upgrade testing | ~~Phase 7~~ **Implemented** | `scripts/test-phase7-hardening.ts` (69/69 PASS) + re-run of the Phase 4/5/6 suites; results in §9 |

---

## 5. Secrets & key inventory

| Secret / key | Where it lives | Used for | Phase |
|---|---|---|---|
| `AUTH_SECRET` (≥32 chars) | Environment only | Session/signing entropy | Implemented |
| `SUPERADMIN_PASSWORD` | Environment only, bootstrap only | Creates the initial super admin hash once; never used for routine logins; never stored | Implemented |
| `APP_ENCRYPTION_KEY` (32-byte base64) | Environment only — **outside the database** | **In use (Phase 4):** AES-256-GCM encryption of customer national IDs; keyed HMAC (SHA-256) lookup index (domain-separated scrypt subkey); portal session signing | Implemented |
| AI provider API keys | Encrypted at rest in AI settings (DB-backed settings service) once Phase 3 lands; never returned to the frontend; masked display; never logged | AI provider adapter | Implemented |

Rotation rules: `AUTH_SECRET` rotation invalidates live sessions (users re-authenticate — acceptable maintenance action). `APP_ENCRYPTION_KEY` rotation requires a documented re-encryption pass for `CustomerProfile.nationalIdEnc` values and invalidates portal sessions; losing it makes stored national IDs unrecoverable by design. AI key rotation is performed from the admin UI (re-seal via the settings service).

**Development-only fallback (v0.7.0, `src/lib/env.ts`):** when `NODE_ENV !== "production"` and `AUTH_SECRET` / `SUPERADMIN_PASSWORD` are absent from the environment, `getEnv()` substitutes deterministic development fallback values and logs a loud warning on every use. This exists because disposable dev machines / hosting sandboxes can reset the project root between restarts — without it, a wiped dev `.env` causes a hard login outage (500 on every login) and, on an empty database, no bootstrap account. The fallbacks are: deterministic `AUTH_SECRET` (stable session/CSRF/encryption-key material across restarts, so nothing encrypted at rest becomes unreadable), and the documented demo password for the initial super admin (relevant only when no super admin exists — bootstrap never overwrites accounts). **Production deployments run with `NODE_ENV=production` and keep the strict fail-fast contract: a missing `AUTH_SECRET` there still refuses to boot.**

**CSRF origin check behind rewriting proxies (v0.7.0, `src/lib/api.ts`):** `assertSameOrigin` accepts a mutation when the request's `Origin` host matches ANY of: the `APP_URL` host (authoritative when configured), every comma-separated part of `x-forwarded-host` (proxy chains accumulate hops — the first part is the client-facing host), the `Host` header, `req.url`'s host, or the entries in `APP_TRUSTED_ORIGINS` (comma-separated escape hatch for proxy chains that rewrite `Host` entirely so the client-facing origin survives in no header; entries starting with a dot are suffix rules accepting every subdomain of that zone — the sandbox preview relay rewrites `Host` to an internal relay host while the browser origin is a fresh `preview-chat-*.space-z.ai` subdomain per session). An attacker origin matches none of these references, so the multi-reference design does not weaken the control; every rejection is logged with the full origin/reference picture (`[origin] rejected mutation — …`) for proxy anomaly diagnosis.

---

## 6. Credential rotation & recovery procedures

### 6.1 Normal rotation (any staff account)

1. User logs in → `/change-password` (or an admin triggers a reset through user management once Phase 2 ships).
2. `POST /api/auth/change-password` verifies the current password, enforces the policy (≥12 chars, upper+lower+digit), stores the new bcrypt hash (cost 12), **revokes all other sessions**, clears `mustChangePassword`, and writes an audit record.

### 6.2 Initial super admin password

- Set once via `SUPERADMIN_PASSWORD` at bootstrap. Bootstrap **refuses to overwrite** an existing super admin on any restart or redeploy, so the env var is not a permanent login mechanism (spec §9.1).
- If the password was not changed after first login, rotate it with the standard procedure in §6.1.

### 6.3 Lost super admin password — current recovery procedure

There is **no committed reset command or CLI flag today** (bootstrap cannot overwrite accounts by design, and no `--reset-password` style flag exists). The documented, SQL-free recovery path is a **one-off administrator script executed on the server by an operator with server access**. The pattern is below; the administrator writes it to a temporary file, runs it, and deletes it.

Preconditions: shell access to the server, the project checkout with dependencies installed, and `DATABASE_URL` pointing at the production database file. Take a backup first (see [BACKUP-RESTORE.md](BACKUP-RESTORE.md)).

```ts
// /tmp/reset-superadmin.ts — ONE-OFF pattern, run by an administrator, then DELETE.
// Execute:  DATABASE_URL="file:/abs/path/to/production.db" \
//           RESET_USERNAME="admin" RESET_PASSWORD="<temporary strong password>" \
//           bun /tmp/reset-superadmin.ts
// (equivalently: bunx tsx /tmp/reset-superadmin.ts)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const username = process.env.RESET_USERNAME!;
const newPassword = process.env.RESET_PASSWORD!;

if (newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
  throw new Error("Temporary password must meet the policy: >=12 chars, upper+lower+digit");
}

const passwordHash = await bcrypt.hash(newPassword, 12);
const user = await prisma.user.update({
  where: { username },
  data: {
    passwordHash,
    mustChangePassword: true,      // force rotation at next login
    failedLoginAttempts: 0,
    lockedUntil: null,
  },
});
await prisma.session.deleteMany({ where: { userId: user.id } }); // revoke every live session
await prisma.auditLog.create({
  data: {
    actorType: "SYSTEM",
    action: "auth.password.recovered", // recorded by the recovery operator
    entityType: "User",
    entityId: user.id,
    actorLabel: username,
    metadata: JSON.stringify({ method: "one-off recovery script" }),
  },
});
await prisma.$disconnect();
console.log("Password reset. Log in and complete the forced password change. Delete this script.");
```

After running: log in with the temporary password at `/login`, complete the forced change at `/change-password`, and delete `/tmp/reset-superadmin.ts`. The temporary password must never match the final one and must not be committed anywhere.

> A dedicated admin CLI with the same semantics (audit-written, lockout-clearing, session-revoking) is a candidate for the Phase 2 operator-management tooling; until then, the one-off script above is the only documented recovery path.

### 6.4 Lockout recovery

A locked account (`lockedUntil` in the future) clears itself after `LOGIN_LOCK_MINUTES`. To unlock immediately, an administrator with server access may clear `failedLoginAttempts`/`lockedUntil` for that user via a similar one-off script — no committed flag exists for this either.

---

## 7. Vulnerability reporting

| Field | Value |
|---|---|
| Security contact | **Launch-blocking field** — the operating organization MUST set this before public exposure. Fill in the placeholder below at deployment time (e.g. a monitored mailbox `security@<your-domain>` plus an out-of-band channel such as a phone number or an encrypted-contact page) and keep this file with the deployment |
| Deployment obligation | Edit this §7 row, commit/publish the change with the deployment, and make sure the mailbox is actually monitored. A deployment with an unfilled contact MUST NOT be exposed to the public internet (spec: vulnerability contact published is a release gate) |
| Process | Report privately with reproduction steps; do not open public issues for exploitable findings; acknowledgement within 5 business days; fixes ship through the normal release process with an entry in the release notes; credit reporters by default unless anonymity is requested |
| Scope | The application as deployed (Next.js server, SQLite database, file storage); the reverse proxy/OS layers are the operator's responsibility — see [DEPLOYMENT.md](DEPLOYMENT.md) |

```text
Security contact (fill in at deployment):
  Email:   security@<your-domain>        ← monitored mailbox
  Channel: <optional: phone / encrypted form / security.txt URL>
  Key:     <optional: PGP fingerprint for encrypted reports>
```

---

## 8. Honest boundary statement

Phase 1 secured the foundation (auth, sessions, RBAC, audit, headers, validation, throttling); phases 2–6 shipped the feature-level controls listed above; Phase 7 re-verified the whole surface end-to-end. The complete as-built threat model is §1; every planned control in §4 is now implemented and tested. Remaining honest limits (per-process rate limiting, keyword-baseline retrieval, SQLite single-node) are documented in ROADMAP.md's per-phase limitation tables and [DATABASE.md](DATABASE.md) — accepted risks for the single-node deployment this release targets.

---

## 9. Phase 7 hardening results (final verification)

**Suite:** `scripts/test-phase7-hardening.ts` — **69/69 PASS** (dev server on :3000). Re-run of every earlier mandated suite on a migration-fresh database: Phase 4 concurrency 12/12, Phase 5 upload security 38/38, Phase 6 permission/audit matrix 26/26.

Coverage highlights:

| Area | Verified |
|---|---|
| HTTP security headers | X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, CSP (frame-ancestors none), API `no-store`, no `X-Powered-By` |
| Cookies | `sd_session` HttpOnly + SameSite=Lax; Secure auto-detected (not forced on plain HTTP dev) |
| Authentication guards | All 14 staff/admin pages redirect anonymous visitors to `/login`; all 12 staff/admin APIs return the uniform 401 envelope |
| CSRF | Cross-origin mutating requests rejected 403 `ORIGIN_MISMATCH` even when authenticated (login, settings PUT, public conversation create) |
| Permission matrix | 15 representative endpoints × 3 roles (SUPER_ADMIN / OPERATOR / FILE_MANAGER) match PERMISSIONS.md exactly; override semantics verified (ALLOW grants audit access to an operator; DENY beats the role's `tickets.view`) |
| Sessions | Server-side revocation: after logout the same cookie is 401 |
| Injection | SQLi payloads in login/search handled by parameterized queries (no crash, no leak); XSS strings stored/returned as inert JSON data (rendering escapes); no executable HTML in responses |
| AI guardrails | Grounded answer from the exact published Q&A; prompt-injection "new management rule" not adopted; out-of-KB abstention with the exact mandated message + escalation offer; cross-department scoping proven with a temporary member-department-only Q&A (asked from the training department → abstention); AI-off department queues honestly; retrieval records + usage logs persisted |
| Error handling | Unknown page 404 without secret leakage; unknown API 404; invalid JSON 400 envelope; validation 422; wrong content-type rejected; no stack traces in any envelope |
| Login throttling | 10/min/IP sliding window: 12 rapid attempts all handled, extras carry `Retry-After` |
| Account lockout | 5 wrong passwords → `lockedUntil` set; correct password rejected while locked (with `Retry-After`); `auth.login.locked` audited; documented recovery unlocks |
| Health endpoint | 200 `status=ok` with database check only — no secrets, PIDs, or env details |

**Findings fixed during Phase 7** (all resolved and re-verified):

1. **Permission-aware landing precedence** — SUPER_ADMIN landed on `/support` after login because `tickets.view` was checked before dashboard access; fixed to `admin.dashboard.view` → `/admin` first (found by the Phase 6 landing test, shipped with Phase 6).
2. **Mobile 390 px horizontal overflow** on `/admin` (permissions-list rows: `truncate` does not reduce a flex container's intrinsic min-content — replaced with `min-w-0 flex-1 line-clamp-1`) and on `/files` (long AV-status badge with `whitespace-nowrap shrink-0` — made wrappable). All 12 key pages now measure exactly 390 px scroll width at 390 px viewport, RTL intact; desktop 1280 px unaffected.
3. **Upgrade/runbook hazard (documented, not a code bug):** databases provisioned via `prisma db push` must never be reconciled with `prisma migrate resolve --applied <all>` + `migrate deploy` — re-applied SQLite table-rebuild migrations (e.g. phase 2's `new_User` pattern) silently drop columns added by later migrations. Reproduced, documented in [DATABASE.md](DATABASE.md) §5.3; the recovery was a clean migration-fresh database + re-seed (all suites re-run green). Backup/restore now also documented to require a **graceful stop** (WAL checkpoint) — see [BACKUP-RESTORE.md](BACKUP-RESTORE.md) §8.

**Accepted risks / honest limits (documented):** in-memory per-process rate limiting (single-node by design), keyword-baseline retrieval (embedding seam reserved), SQLite single-writer (PostgreSQL runbook in DATABASE.md §5), dev-mode error pages reference local `.next/dev` chunk paths (absent in production builds — verified the page leaks no secret names/values), SMS delivery seam returns honest 503 until a gateway is configured.
