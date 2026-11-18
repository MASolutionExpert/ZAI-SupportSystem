/**
 * RAG Engine — core contracts (docs/RAG-ENGINE.md §4).
 *
 * The engine is a reusable backend module: the helpdesk conversation pipeline
 * is a client. Every stage is interface-separated so providers, indexes and
 * strategies stay replaceable. Access scoping is expressed as an explicit
 * `AccessScope` input — retrieval implementations MUST apply it at the data
 * layer, before any content reaches a model.
 */

import type { TranscriptMessage } from "@/lib/conversations/types";

// ------------------------------------------------------------- access scope --

/**
 * Department access scope for retrieval. Mirrors the KB model:
 *  - GLOBAL collections are visible to every department;
 *  - DEPARTMENT collections only through explicit grants (departmentIds);
 *  - RESTRICTED collections and inactive collections are ALWAYS excluded
 *    (enforced inside every retriever, never by the caller's honesty).
 */
export type AccessScope = {
  departmentId: string;
};

// ----------------------------------------------------------------- evidence --

export type EvidenceKind = "QA" | "SECTION" | "PARAGRAPH";

/**
 * One retrieved, authorized evidence unit handed to rerankers / evaluators /
 * generation. `id` is engine-internal (never sent to customers).
 */
export type Evidence = {
  id: string; // stable evidence id (chunk id or qa id) — [n] citation marker key
  kind: EvidenceKind;
  score: number; // 0..1 fused+reranked relevance
  lexicalScore: number;
  semanticScore: number | null; // null when the vector path did not contribute
  // provenance (spec: every indexed chunk retains sufficient provenance)
  documentId: string | null;
  documentTitle: string;
  documentVersionNo: number | null;
  versionId: string | null;
  collectionId: string | null;
  collectionAccess: "GLOBAL" | "DEPARTMENT" | "RESTRICTED" | null;
  headingPath: string | null;
  page: number | null;
  ordinal: number | null;
  indexedAt: string | null;
  // QA-only provenance
  qaId?: string;
  qaQuestion?: string;
  // content
  text: string; // child text (PARAGRAPH) / section text (SECTION) / official answer (QA)
  parentText: string | null; // expanded parent section text when expansion ran
  validUntil: string | null; // document validity metadata
  sourceRef: string | null;
};

export type Citation = {
  /** Evidence id the citation resolves to (engine-internal key). */
  evidenceId: string;
  /** Customer-safe document title. */
  title: string;
  page: number | null;
  section: string | null;
};

// ------------------------------------------------------------------ queries --

export type RagQuery = {
  /** Original, untouched customer question — preserved in every trace. */
  original: string;
  /** Normalized form (Persian normalization) used for lexical matching. */
  normalized: string;
  /** Conversation-aware rewritten form(s) — empty when not applicable. */
  rewrites: string[];
  /** Additional alternative phrasings (multi-query / expansion). */
  expansions: string[];
  /** Decomposed sub-questions for multi-constraint questions. */
  subQueries: string[];
};

// ----------------------------------------------------------------- strategy --

export const RAG_STRATEGIES = [
  "FAST_QA", // authoritative Q&A hit — skip transformations
  "LEXICAL", // keyword/exact-term retrieval only
  "SEMANTIC", // vector retrieval only
  "HYBRID", // lexical + semantic fused (RRF) + rerank
  "MULTI_QUERY", // expansions + hybrid, unioned
  "DECOMPOSE", // sub-questions evidence-merged
] as const;

export type RagStrategy = typeof RAG_STRATEGIES[number];

export const RAG_STRATEGY_LABELS: Record<RagStrategy, string> = {
  FAST_QA: "پاسخ سریع پرسش‌وپاسخ رسمی",
  LEXICAL: "جستجوی دقیق‌عبارتی",
  SEMANTIC: "جستجوی معنایی",
  HYBRID: "جستجوی ترکیبی",
  MULTI_QUERY: "جستجوی چندپرسشی",
  DECOMPOSE: "تجزیه پرسش",
};

// --------------------------------------------------------------- evaluation --

/**
 * CRAG evidence-sufficiency decision for the retrieved evidence set.
 */
export type EvidenceVerdict = "RELEVANT" | "PARTIAL" | "INSUFFICIENT";

export type EvidenceEvaluation = {
  verdict: EvidenceVerdict;
  /** 0..1 — share of the question the evidence can support. */
  sufficiency: number;
  /** Aspects of the question the evidence does NOT cover. */
  uncoveredAspects: string[];
  /** Conflicting statements detected between evidence units. */
  conflicts: Array<{ a: string; b: string; detail: string }>;
  /** Superseded/outdated evidence excluded or flagged. */
  supersededExcluded: boolean;
  /** Persian explanation for the admin trace viewer. */
  rationale: string;
};

export type CorrectiveAction = {
  round: number;
  action:
    | "REWRITE_QUERY"
    | "MULTI_QUERY"
    | "EXPAND_PARENTS"
    | "DECOMPOSE"
    | "RERANK_AGAIN"
    | "HYBRID_RETRIEVE"
    | "BUDGET";
  detail: string;
  result: "IMPROVED" | "NO_CHANGE" | "BUDGET";
};

// -------------------------------------------------------------------- trace --

export type RagIteration = {
  round: number;
  strategy: RagStrategy;
  queries: string[];
  candidates: number;
  reranked: number;
  verdict: EvidenceVerdict;
  sufficiency: number;
};

export type RagTraceData = {
  strategy: RagStrategy;
  iterations: RagIteration[];
  correctiveActions: CorrectiveAction[];
  llmCalls: number;
  durationMs: number;
  budgetExceeded: boolean;
  conflictDetected: boolean;
  supersededExcluded: boolean;
  embeddingModel: string | null;
  promptTokens: number;
  completionTokens: number;
};

// ------------------------------------------------------------------- result --

export const RAG_ANSWER_STATUSES = ["ANSWERED", "CLARIFY", "ABSTAIN", "ESCALATE"] as const;

export type RagAnswerStatus = typeof RAG_ANSWER_STATUSES[number];

export const RAG_ANSWER_STATUS_LABELS: Record<RagAnswerStatus, string> = {
  ANSWERED: "پاسخ مستند",
  CLARIFY: "درخواست شفاف‌سازی",
  ABSTAIN: "انصراف به دلیل نبود مستند کافی",
  ESCALATE: "ارجاع به اپراتور",
};

/**
 * The engine's structured result (task §9). `answerText` is customer-facing
 * Persian; `citations` are customer-safe; `trace`/`evidence` are internal.
 */
export type RagResult = {
  status: RagAnswerStatus;
  answerText: string;
  citations: Citation[];
  confidence: number; // 0..1 evidence sufficiency backing the answer
  strategy: RagStrategy;
  correctiveOccurred: boolean;
  conflictDetected: boolean;
  escalationRecommended: boolean;
  /** Exact question to ask when status === CLARIFY. */
  clarifyQuestion: string | null;
  trace: RagTraceData;
  evidence: Evidence[]; // internal — authorized sources actually used
  /** Summary refs for the legacy KnowledgeRetrievalRecord (reports compat). */
  recordSources: Array<{ kind: EvidenceKind; refId: string; title: string; score: number }>;
};

// ------------------------------------------------------------------- engine --

export type RagAnswerInput = {
  scope: AccessScope;
  departmentName: string;
  question: string;
  /** Recent conversation turns (oldest first) for contextualization. */
  history: TranscriptMessage[];
  /** Applied department confidence floor. */
  minConfidence: number;
  /** True when the department's escalation offer is enabled. */
  escalationOffer: boolean;
  conversationId?: string;
};

// ------------------------------------------------------------ shared helpers --

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
