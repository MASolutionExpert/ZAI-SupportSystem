# KNOWLEDGE-BASE.md — Support Desk

> **Status: As-built (v0.3.0).** This document specified the Phase 3 Knowledge Base (مخزن دانش) per the master spec (§5.1–§5.4) and is now implemented: collections, the document pipeline (PDF/DOCX/TXT/MD with explicit extraction status), the Q&A editor, and department-scoped keyword retrieval are live (`src/lib/kb/*`, `/admin/kb`, `/api/admin/kb/*`); every retrieval is persisted (`KnowledgeRetrievalRecord`). Where wording differs, the code and [ROADMAP.md](ROADMAP.md) §4 are authoritative. The AI behavior that consumes the KB is specified in [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md); schema extension rules in [DATABASE.md](DATABASE.md) §8.

---

## 1. Concept map

```
KnowledgeCollection (مجموعه)          access: GLOBAL | DEPARTMENT | RESTRICTED
        │ 1:n
KnowledgeDocument (سند)               status: UPLOADED → PROCESSING → INDEXED | FAILED | DISABLED
        │ 1:n
KnowledgeDocumentVersion (نسخه)        safe replacement keeps history
        │ 1:n
KnowledgeChunk (قطعه)                 searchable unit; keyword index (+ optional vectors)

KnowledgeQaEntry (پرسش و پاسخ)        authoritative curated answers
        question + official answer + alternates + departments + category + keywords + status

KnowledgeRetrievalRecord (ردیابی)     every retrieval, for audit & quality review
```

Two content sources feed retrieval, exactly as the spec requires (§5.1/§5.2):

1. **Uploaded documents** — PDF / DOCX / TXT / Markdown (other formats only when reliable text extraction exists).
2. **Curated Q&A entries** — structured question/answer pairs the AI treats as authoritative.

---

## 2. Model sketch (final Prisma models land as Phase-3 migrations)

| Planned model | Key fields | Purpose |
|---|---|---|
| `KnowledgeCollection` | name, description, `access` (`GLOBAL` \| `DEPARTMENT` \| `RESTRICTED`), department assignments (n:n), isActive | Organizational unit of knowledge; access level drives retrieval scoping |
| `KnowledgeDocument` | collectionId, title, storage reference (via the storage abstraction), mimeType, size, checksum, `status`, uploadedBy, timestamps | One uploaded document; metadata editable |
| `KnowledgeDocumentVersion` | documentId, version number, storage reference, checksum, uploadedBy, uploadedAt | Replacement history — an old version is never silently destroyed |
| `KnowledgeChunk` | versionId/documentId, ordinal, text, normalized text, token/char spans, (optional) embedding reference, isActive | The indexed search unit; disabled chunks drop out of retrieval |
| `KnowledgeQaEntry` | question, official answer, alternate questions (1:n), department(s) (n:n), category, keywords, `status` (`DRAFT`/`PUBLISHED`/`DISABLED`), last updated | Graphical Q&A editor data (spec §5.2) |
| `KnowledgeRetrievalRecord` | conversationId, query digest, matched chunk/QA references, scores, decision (answered/abstained), createdAt | Source tracking — every AI response traceable to its sources (spec §5.3) |

Department scoping: collections and Q&A entries carry explicit department assignments (n:n) plus a `GLOBAL` access level; `RESTRICTED` marks administrative knowledge retrievable by no customer-facing department.

---

## 3. Document upload & processing pipeline

```
Upload (Super Admin, permission kb.documents.upload)
   │
   ▼
(1) Validate        file type allowlist (PDF/DOCX/TXT/MD), size limits, checksum
   │                stored via the storage abstraction — outside web root, outside the DB
   ▼                 status = UPLOADED
(2) Extract text    PDF / DOCX / TXT / Markdown extractors; unreliable extraction is an
   │                explicit failure, never a silent partial success (spec §5.1)
   ▼                 status = PROCESSING
(3) Normalize       whitespace/encoding cleanup, Persian text handling
   ▼
(4) Chunk           split into meaningful searchable sections (headings/paragraph aware)
   ▼
(5) Index           keyword/full-text index; semantic vectors only when an embedding
   │                model is configured (never mandatory from day one)
   ▼                 status = INDEXED  (available to the AI only now)
   └─ any step fails → status = FAILED with a visible indexing error (spec §5.1)
```

Document statuses (spec §5.1): `Uploaded` · `Processing` · `Indexed` · `Failed` · `Disabled` (final Persian display wording is set during Phase-3 implementation). Failed or partially extracted documents are **never** treated as successfully indexed.

---

## 4. Q&A editor

The Super Admin creates structured entries (spec §5.2) — permission-gated by `kb.qa.create` / `kb.qa.edit` / `kb.qa.publish`:

| Field | Notes |
|---|---|
| Question | Primary phrasing |
| Official answer | The approved authoritative answer |
| Alternate questions | Multiple phrasings of the same answer, improving retrieval without duplicating content (e.g. «شرایط ثبت‌نام دوره مربیگری چیست؟») |
| Department(s) | One or many — scopes retrieval |
| Category | Organizational taxonomy |
| Keywords | Boost/anchor terms for keyword retrieval |
| Status | Draft → Published → (unpublished/disabled); only published entries are retrievable by the AI |
| Last updated | Shown in the editor |

Q&A entries are retrievable **as authoritative information** — when matched, they outrank generic document chunks in relevance weighting.

---

## 5. Retrieval semantics

| Aspect | Design |
|---|---|
| Baseline search | Keyword / full-text over indexed chunks and published Q&A entries — the reliable default at initial scale (spec §5.3) |
| Semantic search | Enabled **only** when an embedding model is configured in AI settings; layered on top, never replacing the keyword path |
| Metadata filtering | Status (indexed/published only), active flags, category, collection |
| Department-level filtering | Hard filter: current department's authorized collections/assignments + `GLOBAL` content; `RESTRICTED` content is excluded from customer-facing retrieval |
| Relevance scoring | Deterministic scoring across keyword/semantic signals; Q&A matches weighted as authoritative; scored threshold feeds the AI's answer/abstain decision |
| Source tracking | Every retrieval writes a `KnowledgeRetrievalRecord` (matched sources + scores) — the AI answer's citations point to these internal source records; internal document content and source metadata are not exposed to customers unless explicitly approved (spec §5.3) |

The retrieval interface is deliberately provider-agnostic: a vector implementation may be introduced later without rewriting the knowledge base (e.g. PostgreSQL full-text/pgvector per the [DATABASE.md](DATABASE.md) switch runbook).

---

## 6. Access control rules

| Content type | Who can retrieve it via AI | Who can manage it |
|---|---|---|
| Global organizational knowledge | All departments' conversations | `kb.*` permission holders |
| Department-specific knowledge | Only that department's conversations | `kb.departments.assign` holders |
| Restricted administrative knowledge | No customer-facing conversation (staff tooling only, if ever) | Explicitly authorized admins only |

Anti-leakage guarantees (spec §5.4):

- The department scope filter runs **before** any provider call — a question asked through department A cannot retrieve department B's restricted knowledge, regardless of phrasing.
- Cross-department retrieval attempts are a mandated Phase-3 test scenario; failures here block the phase (spec §14).
- Only authorized administrators (`kb.*` catalog keys, see [PERMISSIONS.md](PERMISSIONS.md)) may create, edit, publish, or delete KB content.
- Operator internal notes never enter the KB (spec §7.2).

---

## 7. Admin workflows

| Workflow | Permission | Behavior |
|---|---|---|
| View documents & extracted text | `kb.view` | List with status, collection, departments, sizes |
| Edit metadata | `kb.qa.edit`-class permissions | Title/metadata changes do **not** force reprocessing |
| Organize into collections / assign departments | `kb.collections.manage` / `kb.departments.assign` | Collection moves and department assignments take effect at next retrieval (scoping is a live filter) |
| Enable / disable | KB admin keys | Disabled documents/chunks/QA entries drop out of retrieval immediately; history preserved |
| Replace outdated document | KB admin keys | Creates a new `KnowledgeDocumentVersion`, re-runs the pipeline; old version kept in history |
| Reprocess | `kb.documents.reprocess` | Re-run extraction→chunk→index for an existing version (after fixes/changes) |
| Delete | `kb.documents.delete` | Deletes the document **and its associated search index records** (chunks, vectors, index entries) — no orphaned retrievable content |
| See indexing errors | `kb.view` | Failed documents show the actual error; "Failed" is a first-class status |

---

## 8. Phase-3 acceptance checklist (KB side)

From the master spec's phase plan and §5:

- [ ] Document upload across PDF/DOCX/TXT/MD with validation and visible per-document status
- [ ] Failed extraction surfaces as `Failed` with the error — never silently indexed
- [ ] Q&A editor with alternates, departments, category, keywords, status
- [ ] Keyword/full-text retrieval operational without any embedding model
- [ ] Department-scoped retrieval proven by the cross-department test
- [ ] Every AI answer traceable to stored sources; internal metadata not exposed to customers
- [ ] Replace/reprocess/delete flows keep the index consistent (no orphans)
