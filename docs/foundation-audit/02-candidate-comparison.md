# 02 — Candidate Project Comparison

**Research method:** LICENSE files, READMEs and locale files fetched directly from repository raw URLs [V]; metadata from the GitHub REST API and shields.io badge service (star counts are snapshot approximations) [V]; qualitative claims from official docs pages surfaced by web search [V]; anything from memory is marked [U].

## 1. Verified metadata snapshot (2026-11-17)

| Project | Repo | Stars≈ | License [V] | Stack | Last commit | Status |
|---|---|---:|---|---|---|---|
| Zammad | github.com/zammad/zammad | 6.1k | AGPL-3.0 | Ruby/Rails + React | yesterday | Active |
| Chatwoot | github.com/chatwoot/chatwoot | 40k | MIT core + Enterprise dir carve-out | Ruby/Rails + Vue | today | Active |
| FreeScout | github.com/freescout-helpdesk/freescout | 4.7k | AGPL-3.0 | PHP/Laravel | active | Active |
| osTicket | github.com/osTicket/osTicket | 4k | GPL-2.0 (LICENSE.txt) | PHP (no framework) | june (slow) | Maintenance |
| UVdesk | github.com/uvdesk/community-skeleton | 20k† | OSL-3.0 (badge; no LICENSE file found at root [V]) | PHP/Symfony | october | Slow |
| Peppermint | github.com/Peppermint-Lab/peppermint | 3.2k | NOASSERTION (no standard LICENSE found [V]) | TS/Next | **ARCHIVED 2025-09-21 [V]** | Dead |
| GLPI | github.com/glpi-project/glpi | 6.6k | GPL-3.0 (LICENSE) | PHP | yesterday | Active (ITSM) |
| Request Tracker | github.com/bestpractical/rt | 1.2k | GPL-2.0 (COPYING) | Perl | active | Active, niche |
| Rocket.Chat | github.com/RocketChat/Rocket.Chat | 47k | MIT + `ee/` carve-out | Node/Meteor + React | today | Active |
| Tiledesk | github.com/tiledesk/tiledesk | 332 | MIT | Node | november | Small |
| RAGFlow | github.com/infiniflow/ragflow | 94k | Apache-2.0 (LICENSE) | Python | today | Very active |
| Onyx (ex-Danswer) | github.com/onyx-dot-app/onyx | 33k | MIT Expat + Onyx Enterprise License for `ee/` dirs [V — LICENSE read] | Python + Next.js | today | Very active |
| FastGPT | github.com/labring/FastGPT | 30k | Apache-2.0 **with additional conditions** [V — LICENSE read] | Node/TS | today | Active |
| AnythingLLM | github.com/Mintplex-Labs/anything-llm | 68k | MIT (LICENSE) | Node/TS | today | Active |
| LibreChat | github.com/danny-avila/LibreChat | 47k | MIT (LICENSE) | Node/TS | yesterday | Active |
| Qragy | github.com/mahsumaktas/qragy | **4** | AGPL-3.0 (LICENSE) [V] | JS | active | Toy scale (14 open issues) |

† shields.io-reported; cross-check recommended [V-service, suspicious].

## 2. Persian/RTL capability (decision-relevant)

| Project | Finding | Evidence level |
|---|---|---|
| Chatwoot | **Persian verified in-tree**: `config/locales/fa.yml` (58,596 B) and widget locale `app/javascript/widget/i18n/locale/fa.json` (6,285 B) return HTTP 200; official marketing/docs state "translated into 50+ languages … Full RTL support for Arabic, Hebrew, Persian, and Urdu" and RTL shipped in v2.15.0 | **[V] raw fetches + official pages** |
| Zammad | "over 40 languages" per zammad.com; a 2018 community post says Persian translation became available after initial release. Could not verify a Persian locale file in-tree (locale storage layout differs; `config/locales/zammad.*.po` not found on master/stable/develop) | [U] — verify in spike if shortlisted |
| FreeScout | Persian **partially present in-tree**: `resources/lang/fa/validation.php` (5,941 B) HTTP 200; translation UI documented in wiki | [V] partial |
| osTicket | No `fa` in core i18n paths probed; language packs distributed separately | [U] |
| GLPI / RT / Rocket.Chat / UVdesk | Persian locale presence not confirmed in probes | [U] |
| RAG apps (RAGFlow/Onyx/FastGPT/AnythingLLM/LibreChat) | Admin consoles in EN/ZH primarily; Persian not advertised | [U] |

**Note [R]:** none of the candidates ships a Persian RTL *customer portal with national-ID identity*. Chatwoot is the only candidate with verified, in-tree Persian + RTL for both console and widget.

## 3. Infrastructure footprint (production)

| Project | Required services | Evidence |
|---|---|---|
| Zammad | PostgreSQL + Redis ≥7 + Memcached + (optional Elasticsearch) | docs.zammad.org prerequisites + official Helm chart [V] |
| Chatwoot | PostgreSQL + Redis (Sidekiq) | official self-host docs [V-service]; [A] well-established |
| RAGFlow | 4 CPU / **16 GB RAM** / 50 GB disk minimum, Docker | README/docs [V] |
| Onyx | PostgreSQL + Vespa search engine | docs [U — verify in spike] |
| **SupportDesk (current)** | **single container; SQLite + local disk** | `docker-compose.yml`, `Dockerfile` [V] |

## 4. Deep-dive: helpdesk candidates

### 4.1 Zammad
- **Gain:** the deepest ticket system of the field (triggers, macros, SLA, time accounting, scheduling, full REST API, webhooks, 40+ languages, huge install base), upstream security patches from a professional team (last commit yesterday [V]).
- **Must customize:** Persian customer portal (کد ملی identity does not exist), agent console translation completeness, RTL of customer UI.
- **Must integrate:** our portal → Zammad REST API; our RAG engine → Zammad (as external service answering into articles/tickets); citizen identity mapping.
- **Must avoid modifying:** Rails core (fork = permanent divergence).
- **Risks:** AGPL-3.0 obligations (network-use clause: must offer source of modifications to served users); Ruby stack (no team overlap with TS codebase); 4-service infra (PG/Redis/Memcached/±ES); no live-chat widget natively — our guest-chat feature would be a bolt-on; fa locale unverified [U].
- **Complexity:** High. **Upstream compatibility:** preserved only if we stay API-client only.

### 4.2 Chatwoot
- **Gain:** realtime agent console + multichannel inboxes (web widget, email, WhatsApp, Telegram, FB, IG), contacts with identifiers + custom attributes, teams/labels/assignment, public REST + Platform + Widget APIs, webhooks, help-center portals, **verified Persian fa locale + official RTL**, MIT core (fork-friendly, commercial-friendly), very active (commit today [V], 40k★).
- **Must customize:** none of the differentiating logic exists in it — کد ملی identity (map to contact identifier + HMAC), our strict CRAG RAG (Captain AI exists but is Enterprise-licensed code in `enterprise/` [V — `enterprise/LICENSE` read: production use requires Chatwoot Subscription Terms compliance]; recent official docs indicate self-hosted Captain enablement — [U], must verify; we do not rely on it).
- **Must integrate:** citizen portal ↔ Widget/API (identified contacts); webhook loopback for our RAG answers; operator console adoption (fa) or retention of our own console.
- **Must avoid modifying:** `enterprise/` directory; core fork unless unavoidable.
- **Risks:** second user/contact system unless portal drives contacts via API (projection pattern); Postgres+Redis infra; enterprise/ accidental enablement; MIT license is permissive but the enterprise dir must remain untouched.
- **Complexity:** Medium-High (integration), Low-Medium (fork cost due to MIT).
- **Verdict [R]:** best "conversation/channel core" candidate; reasonable as an **add-on gateway**, unjustified as a full replacement of our verified core today (would duplicate tickets/portal/RAG we already run and tested).

### 4.3 FreeScout — AGPL, email-centric, no live-chat core, module ecosystem partially commercial; fa partial [V]. Weaker fit than Chatwoot for chat+portal product; PHP stack.
### 4.4 osTicket — GPLv2, framework-less PHP, dated extension story, no chat; proven but customization-hostile [V license; U architecture impression].
### 4.5 UVdesk — OSL-3.0, Symfony, slow cadence (last commit october), weaker community signals.
### 4.6 GLPI — GPLv3 ITSM/asset-management heavy; wrong product shape for citizen support desk.
### 4.7 Request Tracker — GPL-2.0, Perl, niche; no.
### 4.8 Peppermint — **ARCHIVED 2025-09-21 [V]**, nonstandard license labeling; eliminated.
### 4.9 Tiledesk — MIT, chat+bot+KB, but 332★ and thin team; not a proven foundation.
### 4.10 Rocket.Chat — MIT+ee, chat-first (not ticketing); a channel gateway candidate only if org wants full chat infra; heavy for this scope.

## 5. Deep-dive: RAG subsystem candidates

| Candidate | What it is | Fit as **our** RAG core? |
|---|---|---|
| RAGFlow (Apache-2.0, 94k★) | Full self-hosted RAG service: deep document parsing (OCR/layout), chunking, retrieval, citations, agent workflows | Powerful, but heavy (16 GB RAM min [V]), and it would impose **its** retrieval/chunking policy — our strict CRAG policy (abstain-only, dept-scoped retrieval, verbatim abstention strings, eval harness) is already implemented and tested in-repo [V]. **[R] Optional parsing sidecar for scanned PDFs only.** |
| Onyx (MIT+ee, 33k★) | Team AI search over connectors | Same policy-imposition problem; needs PG+Vespa [U]; ee/ carve-out. Not our brain. |
| FastGPT (Apache+conditions) | KB chat builder | Additional license conditions restrict SaaS-style use [V — LICENSE read]; policy mismatch. |
| AnythingLLM / LibreChat (MIT) | End-user AI chat front-ends | They *replace* our portal, not feed it; wrong shape. |
| Qragy (AGPL-3.0, 4★) | Tiny self-hosted support chatbot | Eliminated: license + scale [V]. In-repo Stage-1 decision confirmed. |
| Libraries (Haystack/LlamaIndex/txtai) | Retrieval frameworks | The engine already implements the pipeline natively; adopting a framework now = rewrite with no verified gain. `VectorIndex`/provider seams exist for scale-out [V]. |

## 6. Comparison summary against this product's requirements

Product requirements (verified implemented today [V]): guest chat widget with AI + handoff; ticket desk with fair distribution; کد ملی citizen identity + follow-up portal; Persian RTL everywhere; strict grounded RAG with citations and abstention; department scoping end-to-end; 52-key RBAC; audit; file hub with AV; ops CLI backup/restore; Docker deploy.

| Candidate | Req. fit | Maturity | License | Custom cost | Infra | Verdict |
|---|---|---|---|---|---|---|
| Zammad core | 6/10 (no chat, no citizen portal) | 9/10 | AGPL (burden) | High (Ruby) | 4 services | Not adopted |
| Chatwoot core | 7/10 | 8/10 | MIT+ee (ok) | Medium-High (Rails + 2nd user system) | PG+Redis | **Add-on gateway candidate (gated)** |
| FreeScout | 5/10 | 7/10 | AGPL | High (PHP) | light | Not adopted |
| osTicket/GLPI/RT/UVdesk | ≤5/10 | mixed | GPL/OSL | High | light | Not adopted |
| Peppermint | 6/10 | n/a | unclear | — | — | **Eliminated (archived)** |
| RAGFlow | RAG-parse 8/10 | 8/10 | Apache-2.0 | Low as sidecar | 16 GB | **Optional sidecar** |
| Onyx/FastGPT/AnythingLLM/LibreChat | ≤5/10 as our engine | high | MIT/cond. | High | heavy | Not adopted |
| **Current app (A+D)** | **10/10** | 7/10 | n/a (owned) | Low-Med (hardening) | 1 container | **Recommended foundation** |
