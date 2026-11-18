# AI-ARCHITECTURE.md — Support Desk

> **Status: As-built (v0.3.0).** This document specified the Phase 3 architecture (Knowledge Base & AI Integration) per the master spec (§4, §6, §10) and is now implemented: the provider-adapter layer (built-in + OpenAI-compatible drivers, encrypted keys), the strict knowledge-grounded RAG flow, the conversation state machine, per-department AI settings, failure handling and the public/operator chat surfaces are live (`src/lib/ai/*`, `src/lib/conversations/*`, `/admin/ai`, `/api/public/conversations/*`, `/api/staff/conversations/*`). The eight mandated Phase-3 scenarios were verified end-to-end (see [ROADMAP.md](ROADMAP.md) §4). Where wording differs, the code and ROADMAP are authoritative; the implemented foundation is described in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Goals and non-goals

| The AI assistant must | The AI assistant must never |
|---|---|
| Answer organizational questions **only** from the approved Knowledge Base | Invent policies, prices, deadlines, procedures, names, contact info, or decisions |
| Cite the internal source records that support each answer | Answer from general model knowledge when organizational evidence is missing |
| Abstain when retrieval is insufficient/contradictory/outdated | Present an unverified answer as official |
| Respect department knowledge boundaries | Retrieve another department's knowledge (spec §5.4) |
| Offer human escalation («ارتباط با اپراتور») when it cannot help | Let documents or customer messages override system rules |
| Preserve every customer message on provider failure | Lose messages, fabricate responses, or hide failure as a plausible answer |

---

## 2. Provider-adapter layer

One OpenAI-compatible adapter behind a small interface; ticketing/KB modules never call a provider directly (spec §6.2).

```
conversation service ──▶ ai/adapters/openai-compatible.ts ──▶ configured Base URL + API key
        │                        │
        │                        ├─ chat(model, messages, params)   → answer
        │                        ├─ embed(model, texts)            → vectors (optional, Phase 3+)
        │                        └─ testConnection()               → availability/model status
        ▼
 ai/settings service (encrypted config, masked keys, test-connection UI)
```

### Configuration (Super Admin UI, permissions `ai.*`)

| Setting | Notes |
|---|---|
| Provider name, API Base URL, API Key | Key stored **encrypted at rest**; never returned in API responses; masked display (e.g. `sk-…9f2c`); secure replacement flow; never logged |
| Chat model / embedding model | Embedding model required only when semantic search is enabled |
| Request timeout, max response tokens, temperature/generation params | Provider errors and timeouts handled gracefully (§6) |
| Global AI enable/disable switch | Master kill switch, independent of department settings |
| Test connection | Shows connection and model availability status; capability gaps of a provider are surfaced explicitly, never silently ignored |

Storage: the AI settings service uses the existing `SystemSetting` key/value store pattern (keys `ai.*`), with values encrypted for secrets. Environment-variable bootstrap configuration remains possible (spec §6.1) but env vars are never the permanent UI-configured path.

---

## 3. Strict knowledge-grounded RAG flow

```
Customer message
     │
     ▼
(1) Guard conversation state          mode = AI-assisted? else → operator flow (§5)
     │
     ▼
(2) Retrieve — authorized KB ONLY     department-scoped filter (§6); keyword/full-text first,
     │                                semantic only if embedding model configured;
     │                                relevance scoring; top-k chunks + Q&A entries
     ▼
(3) Threshold decision                minConfidence per department (spec §4.5)
     │
     ├─ insufficient / contradictory / outdated ──────────────┐
     │                                                        ▼
     │                                        ABSTAIN — send the exact fallback message:
     │      «برای پاسخ دقیق به این سؤال، اطلاعات تأییدشده‌ای در مخزن دانش سازمان پیدا نشد.
     │              می‌توانید درخواست خود را به اپراتور مربوطه ارجاع دهید.»
     │                                        then offer «ارتباط با اپراتور»
     │                                                        │
     ▼                                                        ▼
(4) Answer generation                (5) Human handoff (automatic offer on abstain,
     grounded ONLY on retrieved           or on customer request)
     sources; system prompt forbids       • stop automated answering
     general-knowledge answers and        • create/convert ticket for the department
     fabrication                          • preserve full conversation + retrieval context
     │                                    • place in operator queue; apply department
     ▼                                      assignment policy; notify eligible operators
(5) Citations                         • show ticket status to the customer
     every answer references the       • customer continues the same conversation;
     internal source records            never repeats the question
     (documents/Q&A entries) —
     internal metadata is NOT exposed
     to customers
     │
     ▼
(6) Persist + log                     message, mode, sources (retrieval records),
                                      ai_usage row, audit events
```

Rules enforced at every step:

- **Retrieval precedes generation.** No call to the provider without authorized retrieved context.
- **No evidence → no answer.** The fallback message above is the only output on abstention (spec §4.2) — exactly: «برای پاسخ دقیق به این سؤال، اطلاعات تأییدشده‌ای در مخزن دانش سازمان پیدا نشد. می‌توانید درخواست خود را به اپراتور مربوطه ارجاع دهید.» — followed by the escalation offer; if no operator is available, the customer is informed and the ticket waits in queue.
- **Every response is traceable** to the documents/Q&A entries that supported it — stored for audit and quality review (spec §5.3).

---

## 4. Conversation modes

Each conversation carries exactly one mode (spec §4.4); mode transitions are state-machine events, audited:

| Mode | Meaning | AI behavior |
|---|---|---|
| `AI_ASSISTED` | Customer talking with the assistant | Answers per §3 |
| `WAITING_FOR_OPERATOR` | Handoff requested; queued for the department | **Silent** |
| `ASSIGNED_TO_OPERATOR` | Ticket assigned; operator not yet replied | **Silent** |
| `HUMAN_ACTIVE` | Operator actively conversing | **Silent** unless an authorized operator explicitly re-enables AI assistance |
| `RESOLVED` | Closed/resolved | Silent |

Guarantees: the AI never sends automatic replies over an active human conversation (spec §4.4); operators can review AI responses and take over at any point; the customer experience is one continuous conversation across transitions.

---

## 5. Per-department AI settings (spec §4.5)

Managed via `ai.department.settings.manage`:

| Setting | Effect |
|---|---|
| AI enabled/disabled | Department-level switch (within the global switch) |
| Authorized KB collections | Restricts retrieval for this department |
| Welcome message / fallback message | Defaults to the standard fallback message (§3) |
| Automatic escalation offer on/off | Whether abstention offers «ارتباط با اپراتور» |
| Minimum retrieval confidence threshold | Below it → abstain |
| Conversation & AI usage limits | Cost/rate control |
| AI assistance during human conversations | Off by default (never overrides the global security restriction) |

---

## 6. Failure handling (spec §6.3)

| Failure | Behavior |
|---|---|
| Provider unavailable / timeout / invalid response | Customer message already persisted → **never lost**; clear fallback message shown; escalation offered; technical error logged **without** customer PII or secrets |
| Provider rejects request | Same as above; adapter surfaces the limitation explicitly |
| Contradictory/outdated retrieval | Treated as insufficient → abstain (never "best guess") |
| Rate/usage limits exceeded | Configured per department; overage → abstain + escalation, never silent failure |

Retry policy: bounded retries with backoff for transient provider errors only; no retry may fabricate content — retries re-run the same grounded pipeline.

---

## 7. Security controls (spec §10, AI part)

| Control | Design |
|---|---|
| Untrusted input | Customer messages **and** KB document text are untrusted; never executed, never interpreted as instructions by the application |
| Prompt-injection defense | Retrieved context is framed as data inside a hardened system prompt; explicit rule: retrieved/customer content can never change system behavior or security rules; injection attempts are a Phase-7 test scenario (spec §14) |
| Department-scoped retrieval | Applied **before** sending context to the provider — a question through department A cannot retrieve department B's knowledge (spec §5.4) |
| Server-side credentials | API keys encrypted at rest, server-only, masked in UI, never in frontend JS or logs (spec §6.1) |
| No privileged actions | The AI can execute **no** administrative operations; it cannot modify tickets, users, permissions, or files — it only emits conversation text; any workflow effect happens through separately authorized application operations |
| Rate & usage limits | Per-department conversation and usage limits; global switch as kill valve |
| Internal metadata | System prompts, keys, internal config, retrieval internals, and internal source metadata are never exposed to customers (spec §5.3/§10) |

---

## 8. Retrieval pipeline design

Chunk/index pipeline (document side) and query pipeline (answer side). Keyword/full-text first; embeddings are an optional later layer that does not rewrite the KB (spec §5.3).

```
Document side (on upload / reprocess):
  upload → validate type/size → extract text (PDF/DOCX/TXT/MD) → normalize
        → chunk into meaningful sections → index (keyword/full-text; +vectors if configured)
        → status: Uploaded → Processing → Indexed | Failed → available to AI only when Indexed

Query side:
  question → department scope filter (collections + departments)
           → keyword/full-text search (default path)
           → semantic search (only when an embedding model is configured)
           → merge + metadata filtering + relevance scoring
           → top-k with source references → §3 threshold decision
```

- **Keyword first.** Persian-aware full-text/keyword search is the baseline; a vector implementation may be introduced later without rewriting the knowledge base (spec §5.3) — e.g. by moving to PostgreSQL full-text/pgvector per the [DATABASE.md](DATABASE.md) switch runbook, or an external vector store behind the same retrieval interface.
- **Source tracking.** Every retrieval is recorded (retrieval records: query, results, scores) so any AI response can be audited to its sources.

---

## 9. Observability — `ai_usage` logging & audit traceability

| Record | Contents | Access |
|---|---|---|
| `ai_usage_logs` (planned entity) | Conversation/department, model, prompt/completion token estimates, latency, outcome (answered/abstained/handoff), request ID | `ai.usage.view` reports |
| Retrieval records | Query, matched sources, scores, threshold decision | Internal audit/quality review |
| `AuditLog` (existing) | Mode transitions, handoffs, provider configuration changes (`ai.*` permission-gated actions) | `admin.audit.view` |

Logging rules follow the existing `audit.ts` policy: no secrets, no raw customer PII; technical provider errors go to server logs only.

---

## 10. Implementation mapping (when Phase 3 begins)

| Concern | Lands as |
|---|---|
| Adapter + settings | `src/lib/ai/*` service modules behind the existing guard pair (`requirePermission` with `ai.*` keys) |
| Pipeline | `src/lib/kb/*` retrieval/index services; document statuses per [KNOWLEDGE-BASE.md](KNOWLEDGE-BASE.md) |
| Schema | Prisma migrations adding KB + AI entities (see [DATABASE.md](DATABASE.md) §8) |
| UX | Operator helpdesk + customer conversation UI (spec §7/§3.3), honest chips on `/admin` flip to real modules |

Acceptance testing for Phase 3 follows the master spec's eight scenarios (exact KB answer, document answer, abstention, contradiction, provider outage, cross-department retrieval attempt, prompt-injection attempt, human handoff) — the AI must never invent organizational information in any of them.
