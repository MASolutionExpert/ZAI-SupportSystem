# RAG Engine — Architecture Audit & Implementation Plan (v0.8.0)

Stage 1 deliverable of the Advanced RAG Engine task. This document records the
audit of the current implementation, the Qragy reference inspection (license +
capabilities), the gap analysis, the target architecture, and the staged plan.
It is updated at the end of each stage with the as-built status.

---

## 1. Current implementation audit (pre-engine state)

| Area | Module(s) | Status |
|---|---|---|
| Provider abstraction | `src/lib/ai/adapter.ts` | Solid. `builtin` (z-ai SDK, no key) + `openai-compatible` (Base URL + encrypted key). Secrets decrypted only in-module; sanitized errors; kill switch. **No embeddings endpoint in the builtin SDK** (chat/audio/images/video only). |
| AI settings | `src/lib/ai/settings.ts`, `types.ts` | `embeddingModel` setting **exists but is dead** — nothing consumes it. No embedding call path anywhere. |
| Extraction | `src/lib/kb/extract.ts` | PDF (pdf-parse v2, **flat text only — per-page API unused**), DOCX (mammoth `extractRawText` — headings lost), TXT/MD. No XLSX. Failures are explicit Persian `statusError`s. |
| Chunking | `src/lib/kb/chunking.ts` | Structure-aware (ATX headings attached, sentence splitting, 150–900 chars) but **no heading-path provenance, no page numbers, no parent/child relation, no overlap**. |
| Indexing | `src/lib/kb/pipeline.ts` | Synchronous inside the upload request; versioning + checksum + safe replace/delete; statuses UPLOADED/PROCESSING/INDEXED/FAILED/DISABLED; chunks store `text` + `normalized`. **No embedding columns, no job queue.** |
| Retrieval | `src/lib/kb/retrieval.ts` | Single deterministic keyword scorer (token coverage + density + title boost) over Q&A + chunks. **Hard access scoping** (GLOBAL/DEPARTMENT-grant; RESTRICTED excluded). No lexical/semantic split, no RRF, no rerank, no query transformation. |
| Conversation pipeline | `src/lib/conversations/service.ts` | Disabled/limit checks → retrieve → grounded Persian prompt (anti-injection + conflict-abstain rules) → provider call with bounded retry → model-abstain detection → `KnowledgeRetrievalRecord` + `AiUsageLog` → handoff to tickets (`createHandoffTicket`) preserving the transcript. |
| Observability | `KnowledgeRetrievalRecord`, `AiUsageLog`, admin reports | Retrieval decisions + usage per turn; reports tab in `/admin/reports`. No per-iteration trace, no corrective-action log, no eval. |
| Admin KB | `/admin` knowledge pages | Collections/documents/Q&A CRUD, statuses, AI settings, per-department AI. No engine settings, no trace viewer, no eval UI. |

**Notable strength to preserve:** access isolation is enforced inside retrieval
(DB-level scope filters), the grounding prompt treats document content as data,
and the mandated abstention texts are exact.

## 2. Qragy reference inspection

- Repo: `github.com/mahsumaktas/qragy`, inspected README (817 lines) + LICENSE.
- **License: AGPL-3.0** — strong network copyleft. Our deployment is a
  commercial organizational product; reusing Qragy source would obligate us to
  release the entire combined work under AGPL. **Decision: zero source reuse.**
  Qragy is used strictly as a functional/behavioral reference (a capability
  checklist); the engine is an original TypeScript implementation inside this
  repository's existing architecture. Behavioral inspiration is not copyrightable;
  code is written from scratch.
- Features **actually implemented** in Qragy (per README + repo layout):
  hybrid vector+FTS with RRF; 3-tier reranker (Cohere > LLM > text similarity);
  CRAG with RELEVANT/PARTIAL/IRRELEVANT + bounded query rewrites (2); adaptive
  FAST/STANDARD/DEEP pipeline; reflexion on low-quality answers; CSV Q&A + file
  KB with one-click re-embed; eval scenarios + rule-based judge + consensus runs;
  content-gap detection; XLSX/DOCX/PDF/TXT ingestion; embedded LanceDB + SQLite;
  single process.
- Features **described but marketing-level / experimental**: "knowledge graph",
  memory system (MemGPT-style), 25 admin panels, integrations. Not consulted
  as acceptance targets.

## 3. Gap analysis (task requirement → current state)

| Requirement | Gap |
|---|---|
| Semantic retrieval + vector index | **Missing entirely** (embeddingModel dead setting; SDK has no embeddings) |
| Hybrid + RRF | Missing |
| Query transformation (rewrite/multi-query/expansion/decomposition/contextualization) | Missing (only `normalizePersian`) |
| Parent-child retrieval | Missing (flat chunks) |
| Adaptive strategy selection | Missing (single fixed path) |
| Reranking layer | Missing |
| Corrective RAG controller | Missing (one-shot retrieval; model-level conflict abstain only) |
| Grounded generation with citations + verification | Partial (grounding + anti-injection yes; citations/verification no) |
| Structured engine result (status/confidence/strategy/corrective/escalation) | Missing |
| Provenance (page, heading path, version, access class, indexing time) | Partial (version yes; page/heading no) |
| Background processing | Missing (synchronous in request) |
| XLSX ingestion | Missing |
| Embedding-model safety (versioning, no silent mismatch) | Missing (n/a today) |
| Evaluation framework + metrics + baseline | Missing |
| Admin engine panels (settings/traces/failures/eval) | Missing |

## 4. Target architecture

New engine namespace `src/lib/rag/` — a reusable backend module with clear
interfaces; the helpdesk conversation pipeline becomes a *client* of it.

```
src/lib/rag/
  types.ts            Evidence, RagDecision, RagAnswer, Strategy, Trace contracts
  config.ts           engine settings (SystemSetting `rag.engine`, zod-validated, admin-editable)
  embedding/          EmbeddingProvider interface; factory: openai-compatible /embeddings
                      + builtin `hashed-fa-v1` (deterministic 384-dim hashed char-ngram
                      vectors — offline-safe fallback; explicitly NOT a true semantic
                      model; swap by configuring an embeddings endpoint)
  index/              lexical.ts (LexicalRetriever: token/phrase/identifier scoring),
                      vector.ts (VectorIndex interface + SQLite JSON cosine impl),
                      fusion.ts (RRF)
  query/transform.ts  rewrite / multi-query / expansion / decomposition / conversation
                      contextualization (LLM JSON, budgeted, failure-tolerant)
  rerank/             Reranker interface; HeuristicReranker (default) + LlmReranker (optional)
  crag/               evaluator.ts (evidence sufficiency judge: RELEVANT/PARTIAL/INSUFFICIENT,
                      conflict + supersession detection) + controller.ts (bounded corrective
                      loop with strategy escalation + budgets)
  generate/           answer.ts (citation-marked grounded generation) + verify.ts
                      (citation validation + unsupported-claim screening)
  ingest/             extract.ts (structure-aware: PDF per-page, DOCX heading HTML,
                      XLSX sheets/tables), chunker.ts (heading-path + page + parent/child),
                      pipeline.ts (job-driven ingest/reindex/re-embed)
  jobs.ts             RagJob queue — DB-backed, in-process runner (no new infra), retry/backoff
  trace.ts            RagTrace persistence (full per-iteration trace)
  engine.ts           answer() facade + adaptive strategy selector
  eval/               metrics.ts (Recall@K, Precision@K, MRR, nDCG, latency; answer checks),
                      dataset.ts (acceptance-criteria dataset), runner.ts (reproducible runs)
```

### Data model changes (Prisma / SQLite — existing foundation preserved)

- `KnowledgeChunk` += `headingPath String?`, `page Int?`, `embedding String?`
  (JSON array), `embeddingModel String?`, `embeddingDim Int?`
- `KnowledgeDocument` += `validUntil DateTime?` (validity metadata for
  conflict/supersession reasoning), `sourceRef String?` (original source
  reference)
- New `RagJob` (background jobs), `RagTrace` (per-turn retrieval traces),
  `RagEvalRun` (evaluation results)
- `KnowledgeRetrievalRecord` kept — the engine writes the summary there so
  existing reports remain functional; `RagTrace` adds the deep trace.

### Security model (unchanged, enforced deeper)

Access filtering stays at the retrieval layer (SQL scope on collection access
grants + document status), *before* any LLM sees content. Evidence passed to
models is labeled data; system rules forbid instruction-following from
documents; customer-facing answers expose sanitized citations only (title +
page/section — never internal ids, collection names, or internal metadata).

## 5. Justified deviations from the task text

1. **"Preserve PostgreSQL and Drizzle"** — factually inapplicable: this
   repository's foundation is **Prisma + SQLite** (DATABASE.md §4). Preserving
   the *existing* foundation is the governing rule ("do not rewrite unrelated
   modules"). Vector storage sits behind a `VectorIndex` interface so a
   PostgreSQL + pgvector backend can be introduced without touching retrieval
   logic (same pattern as DATABASE.md §5).
2. **pgvector** — SQLite has no pgvector; the SQLite JSON + in-process cosine
   index is the default implementation behind the abstraction.
3. **Background workers** — implemented as a DB-backed job queue with an
   in-process runner (no new microservice/Redis, per the task's own
   infrastructure restriction). The queue is provider-agnostic and survives
   restarts (PENDING rows resume).
4. **Builtin embeddings** — the sandbox's builtin provider has no embeddings
   endpoint; the engine ships a deterministic hashed-ngram embedding
   (`hashed-fa-v1`) for offline operation and treats a configured
   OpenAI-compatible `/embeddings` endpoint as the production path. Mixed
   model/dim chunks are never searched with incompatible query vectors.

## 6. Staged plan (each stage = one commit + regression)

| Stage | Scope | Acceptance criteria exercised |
|---|---|---|
| 2 | Schema + structure-aware extraction (pages/headings/XLSX) + parent/child chunking with provenance + job-driven ingest + lexical & vector indexing + re-embed | 11, (8 foundation) |
| 3 | Lexical/Vector/Hybrid + RRF + query transformation + parent expansion + rerankers | 1, 2, 3 |
| 4 | CRAG evaluator + bounded corrective controller + abstention | 4, 5, 6, 7 |
| 5 | Citation-aware generation + verification | 9, 6, 7 |
| 6 | Conversation integration + structured outcomes + handoff preservation | 10 |
| 7 | Eval framework + baseline + admin engine panel + docs final | 12, 8 |

## 7. As-built status (updated per stage)

- Stage 1: **complete** — audit + Qragy license decision (AGPL ⇒ zero reuse).
- Stage 2: **complete** — `rag_foundation` migration; structure-aware
  extraction (PDF per-page provenance, DOCX heading HTML, XLSX sheets),
  parent/child chunker with heading-path + page provenance, embedding layer
  (`builtin-hashed` + `openai-compatible`), DB-backed `RagJob` queue with
  in-process runner (instrumentation), `scripts/reingest-docs.ts`.
- Stage 3: **complete** — `LexicalRetriever` (coverage + density + exact
  phrase + identifier boost), `SqliteJsonVectorIndex` behind the
  `VectorIndex` interface (model/dim hard-match; mismatched vectors excluded,
  never silently searched), RRF fusion, query transformation
  (contextualize/rewrite/expand/decompose — budgeted, failure-tolerant),
  parent expansion, rerankers (heuristic default, optional LLM).
- Stage 4: **complete** — CRAG evaluator (deterministic base + LLM judge;
  conflicts with topic-overlap guard; `validUntil` currency filter) and the
  bounded corrective controller (rewrite→multi-query→parent-expansion ladder,
  strategy escalation, hard budgets: rounds/LLM-calls/wall-clock).
- Stage 5: **complete** — citation-marked grounded generation
  (`[n]` markers), deterministic citation validation + forged-marker
  stripping, optional LLM unsupported-claim screening with one grounded
  regeneration, structured insufficient-evidence abstention.
- Stage 6: **complete** — conversation turns run through `rag.answer()`;
  outcome mapping ANSWERED/CLARIFY/ABSTAIN (+ existing explicit handoff
  preserving the transcript); token-aware `AiUsageLog`; RagTrace +
  legacy `KnowledgeRetrievalRecord` written by the engine.
- Stage 7: **complete** — evaluation framework (`bun run rag:eval`,
  dataset `acceptance-v1` = 8 cases across criteria 1–3, 5–8, 11 + 12),
  metrics (Recall@K, Precision@K, MRR, nDCG@5, latency; abstention,
  citation-correctness, keyword support; degraded-mode distinction),
  fixtures provisioned/cleaned per run, `RagEvalRun` persistence; admin
  engine panel `/admin/rag` (overview/settings/traces/evaluation) +
  `/api/admin/rag` (GET/PUT/POST jobs).

### Baseline (acceptance-v1, builtin-hashed embeddings, 2026-11-16)

**8/8 PASS** — recall@5 = 1.0 on every case with a retrievable gold doc;
MRR 1.0 on answerable cases; conflict + superseded + isolation scenarios
assert via status/flags (`conflictDetected`, `supersededExcluded`).
Latency avg ≈ 3–10 s per full engine turn (LLM-bound; heuristic-only
degraded mode ≈ 60–90 ms). With the offline `hashed-fa-v1` fallback the
far-paraphrase case lands via the corrective rewrite loop; configuring a
real embeddings endpoint raises semantic recall further (the interface
place is ready — no code change needed).

### Known limitations (honest)

- `builtin-hashed` is a deterministic fallback, not a semantic model — far
  paraphrase relies on the CRAG rewrite loop rather than vector recall.
- LLM-judge faithfulness scoring (answer-level, beyond deterministic checks)
  is an extension point; citation/claim verification is deterministic.
- SQLite vector search scans scoped candidates in-process — fine at v1
  scale, pgvector is the documented scale-out path behind `VectorIndex`.
- The eval's LLM-dependent cases require a non-throttled provider; runs
  during provider outage are reported as `degraded`, not silently passed.
