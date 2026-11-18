# 03 — License & Compliance Findings

All license conclusions below were made by fetching the actual license artifacts from the source repositories at audit time [V], not from marketing pages.

## 1. Verified license table

| Project | License (verified artifact) | Artifact fetched | Compliance posture for our use |
|---|---|---|---|
| Zammad | GNU AGPL-3.0 | `zammad/zammad` LICENSE (full AGPL text, FSF header) | **Copyleft, network clause.** If we modify Zammad and serve users over a network, we must offer those users the modified source. Interaction via **unmodified** official releases + API from a separate proprietary app does not force disclosure of *our* app, but any in-tree modification does. Trademark "Zammad" is registered [U — verify before redistribution]. |
| Chatwoot | MIT-style core with explicit directory carve-out | `chatwoot/chatwoot` LICENSE ("Portions … under the 'enterprise/' directory … licensed under the license defined in 'enterprise/LICENSE'") + `enterprise/LICENSE` ("may only be used in production, if … in compliance with the Chatwoot Subscription Terms of Service") | Core is permissive (fork/customize/sell allowed, keep copyright notice). **Do not enable or modify `enterprise/` code** (Captain AI, SLA, SSO, audit-log exports etc.) without a subscription. Risk of accidental enablement via UI feature flags — mitigated by deployment review. |
| FreeScout | GNU AGPL-3.0 | `freescout-helpdesk/freescout` LICENSE | Same AGPL analysis as Zammad. Modules marketplace includes paid modules [U]. |
| osTicket | GNU GPL-2.0 (only) | `osTicket/osTicket` LICENSE.txt | GPLv2-only (no "or later"): stricter derivative distribution terms; modifications distributed publicly must be GPLv2. In-house server use without distribution is not a distribution trigger, but AGPL-style network thinking does not apply (GPLv2 has no network clause). |
| UVdesk | OSL-3.0 (per shields badge; root LICENSE file not found at probed paths) | badge [V-service]; artifact not located [U] | OSL-3.0 is network-copyleft-ish (external deployment triggers source availability); low community appetite; verify before any use. |
| Peppermint | NOASSERTION in GitHub API; no standard LICENSE file found at root | API + raw probes [V] | **Unusable licensing signal + archived** — elimination reinforced. |
| GLPI | GPL-3.0 | `glpi-project/glpi` LICENSE | GPLv3 copyleft; not adopted anyway. |
| Request Tracker | GPL-2.0 | `bestpractical/rt` COPYING | Not adopted. |
| Rocket.Chat | MIT core + `ee/` carve-out | LICENSE (read) | Same pattern as Chatwoot. |
| RAGFlow | Apache-2.0 | `infiniflow/ragflow` LICENSE | Permissive; patent grant; safe for sidecar integration. |
| Onyx | MIT Expat core + Onyx Enterprise License for `ee/` directories | LICENSE (read: "Content outside of the above mentioned directories … available under the 'MIT Expat' license") | Permissive core; keep clear of `backend/ee`, `web/src/ee`. |
| FastGPT | Apache-2.0 **+ additional conditions** ("FastGPT Open Source License") | LICENSE (read) | Conditions restrict certain commercialization patterns (multi-tenant SaaS style use) — legal review required before any adoption. |
| AnythingLLM | MIT | LICENSE | Permissive. |
| LibreChat | MIT | LICENSE ("Copyright (c) 2026 LibreChat") | Permissive. |
| Qragy | GNU AGPL-3.0 | `mahsumaktas/qragy` LICENSE | **No code reuse.** Matches the in-repo Stage-1 decision recorded in `docs/RAG-ENGINE.md` (commit `faee06c`). |

## 2. Implications for each live option

- **A+D (recommended, current app):** no third-party copyleft enters the product core. Current dependencies are MIT/ISC/Apache-class per their packages [A — full license audit of node_modules is a standard pre-release step; add `license-checker` to CI]. Integration with Apache-2.0 sidecars (RAGFlow) is clean.
- **C (Chatwoot gateway, unmodified upstream):** permissible under MIT; obligations = retain copyright notice; avoid `enterprise/` features; upstream updates flow normally (we stay on official releases).
- **B (fork Zammad/FreeScout):** AGPL. Internal deployment for an organization is often considered acceptable with internal source access, but if the product is delivered to customers as a hosted service, **modified-source disclosure to those users is mandatory**. This materially raises legal/compliance cost for a commercial product [R: avoid fork; if ever needed, get written legal counsel first].
- **E (from scratch):** no new obligations, but rejected on cost/quality grounds (Doc 05).

## 3. Compliance tasks to institutionalize (roadmap item, not yet implemented)

1. Add license scanning to CI (e.g., `license-checker` or `bunx license-report`) with an allowlist; block GPL/AGPL/OSL/SSPL/eval-licenses from entering `dependencies` [R].
2. Keep `enterprise/`-style directories of adopted projects excluded at the Docker layer (multi-stage build already supports selective copy) [R].
3. Maintain a THIRD-PARTY-NOTICES file generated from the dependency tree [R].
4. Record the Qragy/AGPL no-reuse decision and this audit in the release compliance checklist [V — already partially done in `docs/RAG-ENGINE.md`].

## 4. Bottom line

- Nothing in the recommended path (A+D, plus an unmodified Chatwoot add-on and an Apache-2.0 RAGFlow sidecar) creates copyleft obligations for our code.
- Any temptation to fork AGPL helpdesk cores (Zammad, FreeScout) must be treated as a legal decision, not an engineering shortcut.
